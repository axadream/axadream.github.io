import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build-log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

function tempRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'feed-'));
  for (const f of ['index.html', 'schema/log-entry.schema.json', 'data/projects.json', 'site.config.json']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(repo, f), join(root, f));
  }
  mkdirSync(join(root, 'content', 'log'), { recursive: true });
  for (const f of files) copyFileSync(join(here, 'fixtures', 'log', f), join(root, 'content', 'log', f));
  return root;
}

// Format, links and entry cap are covered by sharing.test.mjs; this covers draft exclusion only.
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
