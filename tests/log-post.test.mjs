import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as lp from '../tools/log-post/post.mjs';
import { parseEntryFile, validateEntry as validateBuildEntry } from '../scripts/build-log.mjs';

const { fileName, renderFile, validateEntry, checkAllow, checkDeny, post, flush } = lp;

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const TOKEN = 'ghp_' + 'x'.repeat(16); // 20-char fake token
assert.equal(TOKEN.length, 20);

const entry = (over = {}) => ({
  ts: '2026-11-12T20:00:00+01:00',
  made: 'Manual',
  track: 'Math',
  text: 'Wrote the log-post tests.',
  cards: ['L1-001', 'L2-010'],
  proof: 'https://github.com/axadream/axadream.github.io/commit/abc123',
  trace: 'First line of the trace.\n\nSecond paragraph.',
  minutes: 45,
  ...over,
});

const tempDir = () => mkdtempSync(join(tmpdir(), 'log-post-'));

/** Fake GitHub Contents API. Records every call. */
function fakeGithub({ getStatus = 404, putStatus = 201, getBody, putBody } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const method = opts.method || 'GET';
    const status = method === 'PUT' ? putStatus : getStatus;
    const body = method === 'PUT' ? putBody : getBody;
    return {
      status,
      json: async () => body ?? { content: { html_url: 'https://github.com/axadream/axadream.github.io/blob/main/x.md' } },
    };
  };
  return { fetch, calls };
}

test('schema copy is byte-equal to schema/log-entry.schema.json', () => {
  const a = readFileSync(join(repo, 'tools', 'log-post', 'log-entry.schema.json'));
  const b = readFileSync(join(repo, 'schema', 'log-entry.schema.json'));
  assert.ok(a.equals(b));
});

test('fileName is deterministic, UTC-stamped and text-addressed', () => {
  const name = fileName(entry());
  assert.ok(name.startsWith('20261112T190000Z-'), name);
  assert.match(name, /^20261112T190000Z-[0-9a-f]{8}\.md$/);
  assert.equal(fileName(entry()), name);
  assert.notEqual(fileName(entry({ text: 'Different text.' })), name);
});

test('renderFile output parses and validates with build-log and log-post', () => {
  const e = entry();
  const file = renderFile(e);
  const parsed = parseEntryFile(file);
  assert.deepEqual(validateBuildEntry(parsed), []);
  assert.deepEqual(validateEntry(e), []);
  assert.equal(parsed.made, 'Manual');
  assert.equal(parsed.track, 'Math');
  assert.deepEqual(parsed.cards, ['L1-001', 'L2-010']);
  assert.equal(parsed.proof, e.proof);
  assert.equal(parsed.trace, e.trace);
  assert.equal(parsed.minutes, 45);
  assert.equal(parsed.text, e.text);
  assert.equal(parsed.tag, undefined);
  assert.equal(parsed.link, undefined);

  const bare = parseEntryFile(renderFile(entry({ cards: undefined, proof: undefined, trace: undefined, minutes: undefined })));
  assert.deepEqual(validateBuildEntry(bare), []);
  assert.equal(bare.cards, undefined);
});

test('validateEntry rejects bad made, bad track, bad card, bad proof, long text, missing offset', () => {
  assert.match(validateEntry(entry({ made: 'Nope' })).join(), /"made" must be one of/);
  assert.match(validateEntry(entry({ track: 'Nope' })).join(), /"track" must be one of/);
  assert.match(validateEntry(entry({ cards: ['L1-01'] })).join(), /"cards" item "L1-01" does not match/);
  assert.match(validateEntry(entry({ proof: 'https://evil.example.com/x' })).join(), /"proof" does not match/);
  assert.match(validateEntry(entry({ text: 'x'.repeat(301) })).join(), /longer than 300/);
  assert.match(validateEntry(entry({ trace: 'x'.repeat(1501) })).join(), /"trace" longer than 1500/);
  assert.match(validateEntry(entry({ ts: '2026-11-12T20:00:00' })).join(), /"ts" does not match/);
  const bad = validateEntry(entry({ made: undefined, track: undefined }));
  assert.match(bad.join(), /missing required field "made"/);
  assert.match(bad.join(), /missing required field "track"/);
});

test('checkAllow: inside and equal paths pass; outside and missing file refuse', () => {
  const home = tempDir();
  const proj = join(home, 'proj');
  mkdirSync(join(proj, 'sub'), { recursive: true });
  const outside = join(home, 'elsewhere');
  mkdirSync(outside);
  try {
    writeFileSync(join(home, 'allowed-projects.txt'), `# comment\n${proj}\n`);
    assert.equal(checkAllow(proj, home).ok, true);
    assert.equal(checkAllow(join(proj, 'sub'), home).ok, true);
    assert.equal(checkAllow(outside, home).ok, false);
    assert.match(checkAllow(outside, home).reason, /not in the allowlist/);

    const empty = tempDir();
    try {
      const miss = checkAllow(proj, empty);
      assert.equal(miss.ok, false);
      assert.match(miss.reason, /not found/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('checkDeny: case-insensitive hit on text and on link, no hit otherwise', () => {
  const home = tempDir();
  try {
    writeFileSync(join(home, 'deny-terms.txt'), '# terms\nSecretWord\n');
    const onText = checkDeny(entry({ text: 'a secretword here', proof: undefined }), home);
    assert.equal(onText.ok, false);
    assert.equal(onText.field, 'text');
    const onLink = checkDeny(entry({ proof: 'https://github.com/axadream/SECRETWORD' }), home);
    assert.equal(onLink.ok, false);
    assert.equal(onLink.field, 'proof');
    assert.equal(checkDeny(entry(), home).ok, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('post: 404 then PUT posts the file; token stays out of messages', async () => {
  const pending = tempDir();
  try {
    const e = entry();
    const name = fileName(e);
    const file = renderFile(e);
    const gh = fakeGithub({ getStatus: 404, putStatus: 201 });
    const r = await post({ entry: e, name, file, token: TOKEN, fetch: gh.fetch, pendingDir: pending });
    assert.equal(r.code, 0);
    assert.equal(r.status, 'posted');
    assert.equal(gh.calls.length, 2);
    const put = gh.calls[1];
    assert.equal(put.opts.method, 'PUT');
    assert.match(put.url, new RegExp(`content/log/${name.replace(/\./g, '\\.')}$`));
    assert.equal(put.opts.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(put.opts.body);
    assert.equal(body.branch, 'main');
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), file);
    assert.ok(!r.message.includes(TOKEN));
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
});

test('post: 200 on GET means exists, nothing written', async () => {
  const pending = tempDir();
  try {
    const e = entry();
    const gh = fakeGithub({ getStatus: 200 });
    const r = await post({ entry: e, name: fileName(e), file: renderFile(e), token: TOKEN, fetch: gh.fetch, pendingDir: pending });
    assert.equal(r.code, 0);
    assert.equal(r.status, 'exists');
    assert.equal(gh.calls.length, 1);
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
});

test('post: network failure queues, flush posts and removes the queue file', async () => {
  const pending = tempDir();
  try {
    const e = entry();
    const name = fileName(e);
    const file = renderFile(e);
    const down = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };
    const q = await post({ entry: e, name, file, token: TOKEN, fetch: down, pendingDir: pending });
    assert.equal(q.code, 2);
    assert.equal(q.status, 'queued');
    assert.deepEqual(readdirSync(pending), [`${name}.json`]);
    assert.ok(!q.message.includes(TOKEN));

    const gh = fakeGithub({ getStatus: 404, putStatus: 201 });
    const f = await flush({ token: TOKEN, fetch: gh.fetch, pendingDir: pending });
    assert.equal(f.code, 0);
    assert.equal(f.posted, 1);
    assert.equal(existsSync(join(pending, `${name}.json`)), false);
    assert.deepEqual(readdirSync(pending), []);
    assert.ok(!f.lines.join('\n').includes(TOKEN));
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
});

test('token is redacted from API error messages', async () => {
  const pending = tempDir();
  try {
    const e = entry();
    const gh = fakeGithub({ getStatus: 401, getBody: { message: `Bad credentials for ${TOKEN}` } });
    const r = await post({ entry: e, name: fileName(e), file: renderFile(e), token: TOKEN, fetch: gh.fetch, pendingDir: pending });
    assert.equal(r.code, 1);
    assert.ok(!r.message.includes(TOKEN));
    assert.ok(r.message.includes('***'));
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
});
