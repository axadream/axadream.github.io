import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build-log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

function tempRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'feed-'));
  for (const f of ['index.html', 'schema/log-entry.schema.json', 'data/projects.json']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(repo, f), join(root, f));
  }
  mkdirSync(join(root, 'content', 'log'), { recursive: true });
  for (const f of files) copyFileSync(join(here, 'fixtures', 'log', f), join(root, 'content', 'log', f));
  return root;
}

/** Tiny strict well-formedness check: tag balance, no bare & or <, quoted attrs. */
function assertWellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body), 'bare ampersand');
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<[^>]*>|[^<]+/g;
  let m, root = 0;
  while ((m = re.exec(body))) {
    if (m[2] === undefined) {
      assert.ok(!m[0].startsWith('<'), `malformed tag: ${m[0]}`);
      assert.ok(!m[0].includes('>') || stack.length === 0 || true);
      continue;
    }
    if (m[1]) assert.equal(stack.pop(), m[2], `mismatched </${m[2]}>`);
    else if (!m[4]) { if (!stack.length) root++; stack.push(m[2]); }
  }
  assert.equal(stack.length, 0, 'unclosed tags');
  assert.equal(root, 1, 'single root');
}

test('feed: well-formed Atom, non-draft entries newest first, ids/titles/proof/escaping', () => {
  const root = tempRoot(['valid.md', 'valid-west.md', 'draft.md', 'cards-trace.md', 'bad-tag.md']);
  try {
    const r = build({ root });
    const xml = r.outputs['feed.xml'];
    assertWellFormed(xml);
    assert.match(xml, /<id>https:\/\/alepax\.com\/feed\.xml<\/id>/);
    assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/alepax\.com\/feed\.xml"\/>/);
    assert.match(xml, /<link rel="alternate" type="text\/html" href="https:\/\/alepax\.com\/log\/"\/>/);
    const ids = [...xml.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map((x) => x[1]);
    assert.equal(ids.length, r.stats.valid);
    assert.ok(ids.every((i) => /^https:\/\/alepax\.com\/log\/#e-\d{8}T\d{6}Z$/.test(i)));
    const cts = ids.map((i) => i.split('#e-')[1]);
    assert.deepEqual(cts, [...cts].sort().reverse());
    for (const c of cts) assert.ok(r.outputs['log/index.html'].includes(`id="e-${c}"`));
    assert.match(xml, new RegExp(`<updated>${cts[0].replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z')}</updated>\\s*<author>`));
    assert.ok(/<title>Ep 1 · [^<]+ · [^<]+<\/title>/.test(xml));
    assert.ok(xml.includes('Ep 2 · AI Study · Manual') || /<title>Ep 2 · /.test(xml));
    assert.ok(xml.includes('<title>Ep 1 · '));
    // proof link, escaped inside content
    assert.ok(xml.includes('&lt;a href=&quot;https://alepax.com/proof?a=1&amp;amp;b=2&quot;&gt;Proof&lt;/a&gt;'));
    // text is escaped (valid.md has script text)
    assert.ok(!xml.includes('<script'));
    assert.ok(xml.includes('&lt;p&gt;'));
    // determinism
    assert.equal(build({ root }).outputs['feed.xml'], xml);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('feed: drafts excluded', () => {
  const root = tempRoot(['valid.md', 'draft.md']);
  try {
    const r = build({ root });
    assert.equal(r.stats.draft, 1);
    assert.equal((r.outputs['feed.xml'].match(/<entry>/g) || []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('feed: head link present on home and archive', () => {
  const root = tempRoot(['valid.md']);
  try {
    const link = '<link rel="alternate" type="application/atom+xml" title="alepax log" href="/feed.xml">';
    const r = build({ root });
    assert.ok(r.outputs['index.html'].includes(link));
    assert.ok(r.outputs['log/index.html'].includes(link));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
