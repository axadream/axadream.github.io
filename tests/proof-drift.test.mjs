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
const FIXTURE = 'ai-no-proof';

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// Temp copy of the repo whose log content is only the AI-guided, no-proof fixture.
function makeCopy() {
  const dir = tempDir('alepax-drift-');
  cpSync(repo, dir, { recursive: true, filter: (src) => !skip.test(src) });
  rmSync(join(dir, 'content', 'log'), { recursive: true, force: true });
  mkdirSync(join(dir, 'content', 'log'), { recursive: true });
  cpSync(join(here, 'fixtures', 'log', FIXTURE + '.md'), join(dir, 'content', 'log', FIXTURE + '.md'));
  return dir;
}

test('proof drift: guard and log-post both refuse AI-guided without proof', () => {
  // (a) guard against a temp copy with the fixture in content/log.
  const dir = makeCopy();
  const build = spawnSync(process.execPath, [join(dir, 'scripts', 'build-log.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const guard = spawnSync(process.execPath, [join(dir, 'scripts', 'check-no-business.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(guard.status, 1, guard.stdout + guard.stderr);
  assert.match(guard.stdout, new RegExp(`content/log/${FIXTURE}\\.md: made=AI-guided requires proof`));

  // (b) log-post --dry with an allowlisted temp cwd and a temp config home; no token, nothing posted.
  const home = tempDir('alepax-drift-home-');
  const cwd = tempDir('alepax-drift-cwd-');
  writeFileSync(join(home, 'allowed-projects.txt'), cwd + '\n', 'utf8');
  const post = spawnSync(
    process.execPath,
    [join(repo, 'tools', 'log-post', 'post.mjs'), '--cwd', cwd, '--ts', '2026-11-09T20:00:00+01:00',
      '--text', 'AI-guided entry with no proof.', '--made', 'AI-guided', '--track', 'App', '--dry'],
    { encoding: 'utf8', env: { ...process.env, ALEPAX_LOG_HOME: home, ALEPAX_LOG_TOKEN: '' } }
  );
  assert.equal(post.status, 4, post.stdout + post.stderr);
  assert.match(post.stdout, /made=AI-guided requires proof/);
});