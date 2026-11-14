import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEntryFile, validateEntry, build, outOfDate, writeOutputs, compactTs, localParts } from '../scripts/build-log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const fx = (n) => readFileSync(join(here, 'fixtures', 'log', n), 'utf8');
const errsOf = (n) => validateEntry(parseEntryFile(fx(n)));

test('valid fixtures parse and validate', () => {
  const o = parseEntryFile(fx('valid.md'));
  assert.equal(o.minutes, 69);
  assert.equal(o.text, 'Valid entry with <script>alert(1)</script> & more.');
  assert.deepEqual(validateEntry(o), []);
  assert.deepEqual(errsOf('valid-west.md'), []);
});

test('invalid fixtures are rejected', () => {
  assert.match(errsOf('unknown-key.md').join(), /unknown key "mood"/);
  assert.match(errsOf('bad-tag.md').join(), /"tag" must be one of/);
  assert.match(errsOf('long-text.md').join(), /longer than 300/);
  assert.match(errsOf('no-offset.md').join(), /"ts"/);
  assert.match(errsOf('bad-link.md').join(), /"link"/);
});

test('draft validates but is flagged', () => {
  const o = parseEntryFile(fx('draft.md'));
  assert.deepEqual(validateEntry(o), []);
  assert.equal(o.draft, true);
});

test('compact ts and weekday in own offset', () => {
  assert.equal(compactTs('2026-11-09T20:00:00+01:00'), '20261109T190000Z');
  assert.deepEqual(localParts('2026-11-09T20:00:00+01:00'), { date: '2026-11-09', dow: 'Mon' });
  assert.equal(compactTs('2026-11-10T22:30:00-05:00'), '20261111T033000Z');
  assert.deepEqual(localParts('2026-11-10T22:30:00-05:00'), { date: '2026-11-10', dow: 'Tue' });
});

test('empty CMS optional fields are treated as absent', () => {
  const text = [
    '---',
    'ts: 2026-11-14T15:53:00+02:00',
    'tag: AI Prompt Skill',
    'minutes: 65',
    "link: ''",
    "project: ''",
    'draft: false',
    '---',
    'hello',
  ].join('\n');
  const o = parseEntryFile(text);
  assert.deepEqual(validateEntry(o), []);
  assert.equal('link' in o, false);
  assert.equal('project' in o, false);
  const bad = parseEntryFile(text.replace("link: ''", 'link: http://x'));
  assert.match(validateEntry(bad).join(), /"link"/);
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'build-log-'));
  for (const f of ['index.html', 'schema/log-entry.schema.json', 'data/projects.json']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(repo, f), join(root, f));
  }
  mkdirSync(join(root, 'content', 'log'), { recursive: true });
  for (const f of readdirSync(join(here, 'fixtures', 'log'))) copyFileSync(join(here, 'fixtures', 'log', f), join(root, 'content', 'log', f));
  return root;
}

test('build: numbering, escaping, counts, --check round-trip', () => {
  const root = tempRoot();
  try {
    const r = build({ root });
    assert.deepEqual([r.stats.valid, r.stats.invalid, r.stats.draft], [2, 5, 1]);
    const home = r.outputs['index.html'];
    assert.match(home, /id="e-20261109T190000Z"><span class="log-ep">Ep 1<\/span><time datetime="2026-11-09T20:00:00\+01:00">2026-11-09 Mon<\/time>/);
    assert.match(home, /id="e-20261111T033000Z"><span class="log-ep">Ep 2<\/span><time datetime="2026-11-10T22:30:00-05:00">2026-11-10 Tue<\/time>/);
    assert.ok(!home.includes('<script>alert'));
    assert.ok(home.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more.'));
    assert.ok(home.includes('<span class="log-min"> · 69 min</span><a class="log-src" href="https://github.com/axadream/alepax" rel="noopener">Source</a>'));
    const nodes = JSON.parse(r.outputs['data/nodes.json']);
    assert.equal(nodes.length, 4);
    assert.equal(nodes[3].id, 'log-20261109T190000Z');
    const map = /<!-- sitemap:start -->([\s\S]*?)<!-- sitemap:end -->/.exec(home)[1];
    assert.ok(map.includes('<a href="#e-20261111T033000Z" data-node="log-20261111T033000Z">'));
    assert.ok(map.includes('<a href="/OpenHorizon/" data-node="openhorizon">'));
    assert.ok(!/log-ep\d/.test(home));
    assert.ok(r.outputs['log/index.html'].includes('href="/#projects"'));

    assert.deepEqual(outOfDate(root, r.outputs).sort(), ['data/nodes.json', 'index.html', 'log/index.html']);
    writeOutputs(root, r.outputs);
    assert.deepEqual(outOfDate(root, build({ root }).outputs), []);
    writeFileSync(join(root, 'data', 'nodes.json'), '[]\n');
    assert.deepEqual(outOfDate(root, build({ root }).outputs), ['data/nodes.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
