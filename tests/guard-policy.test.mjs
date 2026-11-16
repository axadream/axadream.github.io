import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const skip = /[\\/](\.git|node_modules|\.claude)([\\/]|$)/;
const created = [];

// Copy the repo into a temp dir so the tests never mutate the real checkout.
function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'alepax-guard-'));
  created.push(dir);
  cpSync(repo, dir, { recursive: true, filter: (src) => !skip.test(src) });
  // Use schema v2 fixtures as the log content so these tests do not depend on the live posts' schema.
  rmSync(join(dir, 'content', 'log'), { recursive: true, force: true });
  mkdirSync(join(dir, 'content', 'log'), { recursive: true });
  for (const f of ['valid.md', 'valid-west.md']) cpSync(join(here, 'fixtures', 'log', f), join(dir, 'content', 'log', f));
  return dir;
}

function run(cwd, args) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

function guard(dir, extra = []) {
  return run(dir, [join(dir, 'scripts', 'check-no-business.mjs'), ...extra]);
}

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

test('fresh build outputs: guard passes in default and strict mode', () => {
  const dir = makeCopy();
  const build = run(dir, [join(dir, 'scripts', 'build-log.mjs')]);
  assert.equal(build.status, 0, build.stderr);

  const def = guard(dir);
  assert.equal(def.status, 0, def.stdout + def.stderr);

  const strict = guard(dir, ['--strict']);
  assert.equal(strict.status, 0, strict.stdout + strict.stderr);
});

test('stale build outputs: default warns and passes, strict fails', () => {
  const dir = makeCopy();
  const build = run(dir, [join(dir, 'scripts', 'build-log.mjs')]);
  assert.equal(build.status, 0, build.stderr);

  // Add a valid new entry without rebuilding, so build-log --check reports stale.
  writeFileSync(
    join(dir, 'content', 'log', '20261201T190000Z-stale-probe.md'),
    '---\nts: 2026-12-01T20:00:00+01:00\nmade: Manual\ntrack: Math\n---\nStale probe entry.\n',
    'utf8'
  );

  const def = guard(dir);
  assert.equal(def.status, 0, def.stdout + def.stderr);
  assert.match(def.stdout + def.stderr, /WARN/);

  const strict = guard(dir, ['--strict']);
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
});

test('user-action load: site.js graph import without the marker fails the guard', () => {
  const dir = makeCopy();
  // Fixture site.js whose only graph reference lacks the /* user-action-load */ marker.
  writeFileSync(
    join(dir, 'assets', 'js', 'site.js'),
    "const graph = () => import('./graph-scene.js');\n",
    'utf8'
  );

  const def = guard(dir);
  assert.equal(def.status, 1, def.stdout + def.stderr);
  assert.match(def.stdout, /user-action load: assets\/js\/site\.js line 1 .*\/\* user-action-load \*\//);
});
