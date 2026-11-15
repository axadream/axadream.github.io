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
  assert.equal(o.made, 'Manual');
  assert.equal(o.track, 'AI Study');
  assert.equal(o.text, 'Valid entry with <script>alert(1)</script> & more.');
  assert.deepEqual(validateEntry(o), []);
  assert.deepEqual(errsOf('valid-west.md'), []);
  assert.deepEqual(errsOf('trace-1500.md'), []);
});

test('invalid fixtures are rejected', () => {
  assert.match(errsOf('unknown-key.md').join(), /unknown key "mood"/);
  assert.match(errsOf('bad-tag.md').join(), /unknown key "tag"/);
  assert.match(errsOf('long-text.md').join(), /longer than 300/);
  assert.match(errsOf('no-offset.md').join(), /"ts"/);
  assert.ok(errsOf('bad-proof.md').join().includes('"proof" does not match ^https://(github\\.com/axadream/|alepax\\.com/).+'));
  assert.match(errsOf('no-made.md').join(), /missing required field "made"/);
  assert.match(errsOf('no-track.md').join(), /missing required field "track"/);
  assert.match(errsOf('bad-card.md').join(), /"cards" item "X9-1"/);
  assert.match(errsOf('long-trace.md').join(), /"trace" longer than 1500 \(1501\)/);
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
  const o = parseEntryFile(fx('empty-optionals.md'));
  assert.deepEqual(validateEntry(o), []);
  for (const k of ['minutes', 'cards', 'proof', 'trace']) assert.equal(k in o, false, k);
  assert.equal(o.draft, false);
  const bad = parseEntryFile(fx('empty-optionals.md').replace("proof: ''", 'proof: http://x'));
  assert.match(validateEntry(bad).join(), /"proof"/);
});

test('real Sveltia post (old schema) parses; empties absent; v2 rules reject it', () => {
  const o = parseEntryFile(fx('sveltia-pytest.md'));
  assert.equal(o.tag, 'AI Prompt Skill');
  assert.equal(o.minutes, 65);
  assert.equal(o.draft, false);
  assert.equal('link' in o, false);
  assert.equal('project' in o, false);
  assert.equal(o.text, 'working on alepax.com');
  const e = validateEntry(o).join();
  assert.match(e, /unknown key "tag"/);
  assert.match(e, /missing required field "made"/);
  assert.match(e, /missing required field "track"/);
});

test('Sveltia list and multi-line block scalar', () => {
  const o = parseEntryFile(fx('cards-trace.md'));
  assert.deepEqual(validateEntry(o), []);
  assert.deepEqual(o.cards, ['L1-001', 'L2-014']);
  assert.equal(o.proof, 'https://alepax.com/proof?a=1&b=2');
  assert.equal(o.trace, 'Prompt: write <b>a parser</b> & test it.\n\nAI bug: it dropped the last item.\nFixed by hand.');
  assert.equal(o.draft, false);
});

test('proof: github.com/axadream and alepax.com pass; other hosts fail', () => {
  const base = fx('valid.md');
  const withProof = (u) => base.replace('proof: https://github.com/axadream/alepax', `proof: ${u}`);
  assert.deepEqual(validateEntry(parseEntryFile(withProof('https://github.com/axadream/alepax/pull/1'))), []);
  assert.deepEqual(validateEntry(parseEntryFile(withProof('https://alepax.com/log/1'))), []);
  const e = validateEntry(parseEntryFile(withProof('https://example.org/x'))).join();
  assert.ok(e.includes('"proof" does not match ^https://(github\\.com/axadream/|alepax\\.com/).+'), e);
});

test('quoted, folded and flow forms', () => {
  const head = '---\nts: 2026-11-08T10:00:00Z\nmade: Manual\ntrack: Math\n';
  const q = parseEntryFile(head + 'trace: "line one\\nline \\"two\\"\n  continued\n\n  after blank"\ncards: [L1-001, "L2-002"]\n---\nb');
  assert.equal(q.trace, 'line one\nline "two" continued\nafter blank');
  assert.deepEqual(q.cards, ['L1-001', 'L2-002']);
  assert.deepEqual(validateEntry(q), []);
  const f = parseEntryFile(head + "trace: >-\n  folded\n  text\n\n  next\n---\nb");
  assert.equal(f.trace, 'folded text\nnext');
  const s = parseEntryFile(head + "trace: 'it''s'\n---\nb");
  assert.equal(s.trace, "it's");
});

test('front matter parse failures throw', () => {
  assert.throws(() => parseEntryFile('no front matter'), /front matter/);
  assert.throws(() => parseEntryFile('---\nts: x\nnot a key value\n---\nb'), /bad front matter line/);
  assert.throws(() => parseEntryFile('---\nts: 2026-11-08T10:00:00Z\ntrace: "never closed\n---\nb'), /unterminated/);
});

function tempRoot(files, config) {
  const root = mkdtempSync(join(tmpdir(), 'build-log-'));
  for (const f of ['index.html', 'schema/log-entry.schema.json', 'data/projects.json']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(repo, f), join(root, f));
  }
  if (config) writeFileSync(join(root, 'site.config.json'), JSON.stringify(config));
  mkdirSync(join(root, 'content', 'log'), { recursive: true });
  for (const f of files || readdirSync(join(here, 'fixtures', 'log'))) copyFileSync(join(here, 'fixtures', 'log', f), join(root, 'content', 'log', f));
  return root;
}

const BUILD_SET = ['valid.md', 'valid-west.md', 'draft.md', 'unknown-key.md', 'bad-tag.md', 'long-text.md', 'no-offset.md', 'bad-proof.md'];

test('build: numbering, escaping, counts, --check round-trip', () => {
  const root = tempRoot(BUILD_SET);
  try {
    const r = build({ root });
    assert.deepEqual([r.stats.valid, r.stats.invalid, r.stats.draft], [2, 5, 1]);
    const home = r.outputs['index.html'];
    assert.match(home, /id="e-20261109T190000Z"><span class="log-ep">Ep 1<\/span><time datetime="2026-11-09T20:00:00\+01:00">2026-11-09 Mon<\/time>/);
    assert.match(home, /id="e-20261111T033000Z"><span class="log-ep">Ep 2<\/span><time datetime="2026-11-10T22:30:00-05:00">2026-11-10 Tue<\/time>/);
    assert.ok(!home.includes('<script>alert'));
    assert.ok(home.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more.'));
    assert.ok(home.includes('<span class="badge-made badge-made-manual">Manual</span><span class="log-track track-ai-study">AI Study</span>'));
    assert.ok(home.includes('<span class="log-min"> · 69 min</span><a class="log-src" href="https://github.com/axadream/alepax" rel="noopener noreferrer">Proof</a>'));
    assert.ok(!home.includes('log-trace'));
    const nodes = JSON.parse(r.outputs['data/nodes.json']);
    assert.equal(nodes.length, 4);
    assert.equal(nodes[3].id, 'log-20261109T190000Z');
    assert.equal(nodes[3].track, 'ai-study');
    assert.equal(nodes[2].track, '3d');
    assert.ok(nodes.filter((n) => n.type === 'log').every((n) => !('project' in n)));
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

test('build: cards plain text without handbook_base, links with it; trace and proof escaped', () => {
  const plain = tempRoot(['cards-trace.md']);
  const linked = tempRoot(['cards-trace.md'], { handbook_base: 'https://handbook.example.org/' });
  try {
    const a = build({ root: plain }).outputs['index.html'];
    assert.ok(a.includes('<span class="log-cards"><span class="log-card-id">L1-001</span><span class="log-card-id">L2-014</span></span>'));
    assert.ok(!a.includes('handbook.example.org'));
    const b = build({ root: linked });
    assert.deepEqual([b.stats.valid, b.stats.invalid], [1, 0]);
    const h = b.outputs['index.html'];
    assert.ok(h.includes('<a class="log-card-id" href="https://handbook.example.org/#l1-001">L1-001</a>'));
    assert.ok(h.includes('href="https://handbook.example.org/#l2-014"'));
    for (const out of [a, h, b.outputs['log/index.html']]) {
      assert.ok(out.includes('<details class="log-trace"><summary>Prompt trace</summary><p>Prompt: write &lt;b&gt;a parser&lt;/b&gt; &amp; test it.</p><p>AI bug: it dropped the last item.<br>Fixed by hand.</p></details>'));
      assert.ok(out.includes('href="https://alepax.com/proof?a=1&amp;b=2" rel="noopener noreferrer">Proof</a>'));
      assert.ok(!out.includes('<b>a parser'));
    }
    assert.ok(b.outputs['log/index.html'].includes('<span class="badge-made badge-made-ai-guided">AI-guided</span><span class="log-track track-app">App</span>'));
  } finally {
    rmSync(plain, { recursive: true, force: true });
    rmSync(linked, { recursive: true, force: true });
  }
});

test('build: empty optionals render no cards, proof or trace', () => {
  const root = tempRoot(['empty-optionals.md']);
  try {
    const home = build({ root }).outputs['index.html'];
    assert.ok(home.includes('All optionals empty.'));
    for (const s of ['log-cards', 'log-trace', 'log-src', 'log-min']) assert.ok(!home.includes(s), s);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build: a front matter parse failure throws and names the file', () => {
  const root = tempRoot(['valid.md']);
  try {
    writeFileSync(join(root, 'content', 'log', 'broken.md'), 'no front matter here\n');
    assert.throws(() => build({ root }), /content\/log\/broken\.md: front matter parse failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('log-post schema copy is identical', () => {
  assert.equal(readFileSync(join(repo, 'schema', 'log-entry.schema.json'), 'utf8'), readFileSync(join(repo, 'tools', 'log-post', 'log-entry.schema.json'), 'utf8'));
});
