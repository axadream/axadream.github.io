import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

test('about page: title line and jobTitle are emitted', () => {
  const about = read('about/index.html');
  assert.ok(about.includes('Industrial IT &amp; MES Consultant'), 'title line');
  assert.ok(about.includes('"jobTitle":"Industrial IT and MES consultant"'), 'jobTitle');
});

test('home: #hero-box sits inside the hero section and there is no #graph section', () => {
  const home = read('index.html');
  const start = home.indexOf('class="hero wrap"');
  assert.ok(start >= 0, 'hero section present');
  const end = home.indexOf('</section>', start);
  const box = home.indexOf('id="hero-box"');
  assert.ok(box > start && box < end, 'hero-box inside hero section');
  assert.ok(!/id="graph"/.test(home), 'no #graph section');
});

test('home: play and reload buttons exist', () => {
  const home = read('index.html');
  assert.ok(/id="graph-play"/.test(home), '#graph-play');
  assert.ok(/id="graph-reload"/.test(home), '#graph-reload');
});

test('site.js: reload failure path is wired and user-action-load marker appears once', () => {
  const js = read('assets/js/site.js');
  assert.equal(js.split('/* user-action-load */').length - 1, 1, 'marker once');
  assert.ok(js.includes("if (!(await rebuild())) { ui(false);"), 'reload failure restores idle state');
});

test('shipped pages contain no double-encoded characters', () => {
  const bad = /â€|Â[·©]/;
  for (const p of ['index.html', 'about/index.html', 'log/index.html']) {
    assert.ok(!bad.test(read(p)), p + ' has mojibake');
  }
});
