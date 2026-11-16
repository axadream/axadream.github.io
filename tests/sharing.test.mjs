import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const MAX = 61440;
const IMG_BASE = 'https://alepax.com/assets/img/';
const FEED_URL = 'https://alepax.com/feed.xml';

function pages() {
  const list = ['index.html', 'about/index.html', 'log/index.html'];
  const work = join(repo, 'work');
  if (existsSync(work)) {
    for (const d of readdirSync(work)) {
      const p = join('work', d, 'index.html');
      if (existsSync(join(repo, p))) list.push(p);
    }
  }
  return list;
}

// Atom block must carry non-empty id, title and updated elements.
const assertHasTags = (block, label) => {
  for (const tag of ['id', 'title', 'updated']) {
    assert.match(block, new RegExp(`<${tag}>[^<]+</${tag}>`), `${label} has <${tag}>`);
  }
};

const attrs = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
const metaContent = (html, attr, name) =>
  attrs(html, new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`, 'g'));

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
}

// ---------- a) per-page share tags ----------

for (const p of pages()) {
  test(`share tags on ${p}`, () => {
    const html = read(p);
    const images = metaContent(html, 'property', 'og:image');
    assert.equal(images.length, 1, 'exactly one og:image');
    assert.ok(images[0].startsWith(IMG_BASE), `og:image under ${IMG_BASE}`);
    const name = images[0].slice(IMG_BASE.length);
    assert.ok(existsSync(join(repo, 'assets', 'img', name)), `${name} exists`);
    assert.ok(statSync(join(repo, 'assets', 'img', name)).size <= MAX, `${name} <= ${MAX} B`);

    const tw = metaContent(html, 'name', 'twitter:image');
    assert.deepEqual(tw, [images[0]], 'exactly one twitter:image equal to og:image');

    for (const prop of ['og:title', 'og:description', 'og:url']) {
      assert.equal(metaContent(html, 'property', prop).length, 1, `${prop} present`);
    }
    assert.equal(metaContent(html, 'name', 'twitter:card').length, 1, 'twitter:card present');

    const feedLinks = attrs(html, /<link rel="alternate" type="application\/atom\+xml"[^>]*href="([^"]*)"/g);
    assert.deepEqual(feedLinks, [FEED_URL], 'exactly one Atom alternate link to /feed.xml');
  });
}

// ---------- b) generated share images ----------

test('og-home, og-about, og-log, og-work exist and are <= 60 KB', () => {
  for (const t of ['home', 'about', 'log', 'work']) {
    const png = join(repo, 'assets', 'img', `og-${t}.png`);
    const jpg = join(repo, 'assets', 'img', `og-${t}.jpg`);
    const f = existsSync(png) ? png : jpg;
    assert.ok(existsSync(f), `og-${t}.png or .jpg exists`);
    assert.ok(statSync(f).size <= MAX, `og-${t} <= ${MAX} B`);
  }
});

test('legacy assets/img/og.png is removed', () => {
  assert.equal(existsSync(join(repo, 'assets', 'img', 'og.png')), false);
});

// ---------- c) Atom feed ----------

test('feed.xml is a valid Atom skeleton with 1..10 entries', () => {
  const xml = read('feed.xml');
  assert.ok(xml.startsWith('<?xml'), 'starts with <?xml');
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  const head = xml.slice(0, xml.indexOf('<entry>') === -1 ? xml.length : xml.indexOf('<entry>'));
  assertHasTags(head, 'feed');
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  assert.ok(entries.length >= 1 && entries.length <= 10, `1..10 entries, got ${entries.length}`);
  for (const e of entries) {
    assertHasTags(e, 'entry');
    assert.match(e, /<link href="[^"]+"\/>/, 'entry has <link>');
  }
});

// ---------- d) JSON-LD ----------

test('log/ Blog JSON-LD lists the newest min(10, rows) posts, newest first', () => {
  const html = read('log/index.html');
  const blocks = jsonLd(html);
  const blogs = blocks.filter((b) => b['@type'] === 'Blog');
  assert.equal(blogs.length, 1, 'exactly one Blog block');
  const posts = blogs[0].blogPost;
  assert.ok(Array.isArray(posts), 'blogPost is an array');
  const rows = (html.match(/class="log-row"/g) || []).length;
  assert.equal(posts.length, Math.min(10, rows), 'blogPost count = min(10, rows)');

  let prev = null;
  for (const post of posts) {
    assert.equal(post['@type'], 'BlogPosting');
    assert.match(post.headline, /^Ep \d+ · .+$/);
    assert.ok(post.url.startsWith('https://alepax.com/log/#'), `url ${post.url}`);
    const frag = post.url.slice(post.url.indexOf('#') + 1);
    assert.ok(html.includes(`id="${frag}"`), `fragment #${frag} exists in log page`);
    if (prev !== null) assert.ok(post.datePublished <= prev, 'newest first');
    prev = post.datePublished;
  }
});

test('about/ has Person and ProfilePage JSON-LD that parse', () => {
  const types = jsonLd(read('about/index.html')).map((b) => b['@type']);
  assert.ok(types.includes('Person'), 'Person block');
  assert.ok(types.includes('ProfilePage'), 'ProfilePage block');
});

// ---------- Open Graph type ----------

test('about/ is an og:type profile with first and last name', () => {
  const html = read('about/index.html');
  assert.deepEqual(metaContent(html, 'property', 'og:type'), ['profile'], 'og:type profile');
  assert.deepEqual(metaContent(html, 'property', 'profile:first_name'), ['Alex'], 'first name');
  assert.deepEqual(metaContent(html, 'property', 'profile:last_name'), ['Pintea'], 'last name');
});

for (const p of ['index.html', 'log/index.html']) {
  test(`${p} is og:type website without profile tags`, () => {
    const html = read(p);
    assert.deepEqual(metaContent(html, 'property', 'og:type'), ['website'], 'og:type website');
    assert.equal(metaContent(html, 'property', 'profile:first_name').length, 0, 'no profile:first_name');
    assert.equal(metaContent(html, 'property', 'profile:last_name').length, 0, 'no profile:last_name');
  });
}

// ---------- version ----------

test('version from site.config.json is consistent across CHANGELOG and footer', () => {
  const version = JSON.parse(read('site.config.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const esc = version.replace(/\./g, '\\.');
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${esc}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  const foot = /<p class="foot-ver">[\s\S]*?<\/p>/.exec(read('index.html'))[0];
  assert.ok(foot.includes(`>v${version}<`), `footer shows v${version}`);
});

// ---------- footer ----------

test('every generated page footer shows (c) year and version, no date, year is newest non-draft entry year', () => {
  const version = JSON.parse(read('site.config.json')).version;
  const dir = join(repo, 'content', 'log');
  const years = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(read(`content/log/${f}`).replace(/\r\n/g, '\n'));
    if (!fm || /^draft:\s*true\s*$/m.test(fm[1])) return null;
    const ts = /^ts:\s*(\S+)/m.exec(fm[1]);
    return ts ? Number(ts[1].slice(0, 4)) : null; // year as written in the ts
  }).filter((y) => y !== null);
  const newest = Math.max(...years);
  const re = new RegExp(`<p class="foot-ver">© (\\d{4}) Alex Pintea · <a [^>]*>v${version.replace(/\./g, '\\.')}</a></p>`);
  for (const p of ['index.html', 'about/index.html', 'log/index.html']) {
    const html = read(p);
    const m = re.exec(html);
    assert.ok(m, `${p}: foot-ver matches`);
    assert.equal(Number(m[1]), newest, `${p}: year is newest entry year`);
    assert.doesNotMatch(m[0], /<time/, `${p}: no <time> in foot-ver`);
    assert.doesNotMatch(html, /all rights reserved/i, `${p}: no "all rights reserved"`);
  }
});
