// build-log.mjs - generates the practice log from content/log/*.md.
//
// Usage:
//   node scripts/build-log.mjs           write outputs
//   node scripts/build-log.mjs --check   render in memory, exit 1 if any output is out of date
//
// Inputs : content/log/*.md, schema/log-entry.schema.json, data/projects.json, index.html
// Also: content/about.md -> about/index.html, an /about/ entry in sitemap.xml, and index.html JSON-LD jobTitle.
// Outputs: index.html (only between <!-- log:start --> and <!-- log:end -->),
//          log/index.html (fully generated), data/nodes.json
// Schema-invalid entries are reported, skipped, and make the run exit 1. A front matter PARSE failure
// throws (exit 1, names the file). Drafts are skipped silently.
// Plain Node ESM, node: builtins only. Importing this module does not run the build.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOME_COUNT = 3;
const NODE_COUNT = 12;
const LABEL_MAX = 60;
const ROOT_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(ROOT_DEFAULT, 'schema', 'log-entry.schema.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- parsing ----------

const ESCAPES = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ' };
const isBlank = (l) => l.trim() === '';
const indentOf = (l) => /^ */.exec(l)[0].length;

/** Read a quoted scalar starting at `start` (first char is the quote) on lines[i]; may span lines. */
function readQuoted(lines, i, start) {
  const q = start[0];
  let cur = start.slice(1), out = '', joinNone = false;
  for (;;) {
    for (let j = 0; j < cur.length; j++) {
      const c = cur[j];
      if (q === '"' && c === '\\') {
        const n = cur[++j];
        if (n === undefined) joinNone = true; // escaped line break: join without space
        else if (n === 'u') { out += String.fromCharCode(parseInt(cur.slice(j + 1, j + 5), 16)); j += 4; }
        else out += n in ESCAPES ? ESCAPES[n] : n;
      } else if (c === q) {
        if (q === "'" && cur[j + 1] === "'") { out += "'"; j++; continue; }
        const rest = cur.slice(j + 1).trim();
        if (rest && !rest.startsWith('#')) throw new Error(`unexpected text after closing quote: ${rest}`);
        return { value: out, next: i + 1 };
      } else out += c;
    }
    // line ended inside the quotes: fold (single break -> space, blank lines -> newlines)
    let b = 0;
    i++;
    while (i < lines.length && isBlank(lines[i])) { b++; i++; }
    if (i >= lines.length) throw new Error('unterminated quoted string');
    if (!joinNone) out = out.replace(/[ \t]+$/, '');
    out += b ? '\n'.repeat(b) : (joinNone ? '' : ' ');
    joinNone = false;
    cur = lines[i].replace(/^[ \t]+/, '');
  }
}

/** Read a | or > block scalar whose header is lines[i-1]; returns { value, next }. */
function readBlock(lines, i, style) {
  let k = i;
  while (k < lines.length && isBlank(lines[k])) k++;
  const ind = k < lines.length ? indentOf(lines[k]) : 0;
  if (ind === 0) return { value: '', next: i };
  const body = [];
  let j = i;
  for (; j < lines.length; j++) {
    if (isBlank(lines[j])) { body.push(''); continue; }
    if (indentOf(lines[j]) < ind) break;
    body.push(lines[j].slice(ind));
  }
  let value;
  if (style === '|') value = body.join('\n');
  else {
    value = '';
    body.forEach((l, n) => {
      if (n === 0) value = l;
      else if (l === '') value += '\n';
      else value += (body[n - 1] === '' || value.endsWith('\n') ? '' : ' ') + l;
    });
  }
  return { value: value.replace(/\s+$/, ''), next: j };
}

function scalar(raw) {
  const v = raw.trim();
  if (v[0] === '"' || v[0] === "'") return readQuoted([v], 0, v).value;
  return v;
}

/**
 * Parse "---\nkey: value\n---\nbody" into an object; body becomes `text`.
 * Supports plain/quoted (multi-line) scalars, | and > block scalars, and block or flow lists
 * (the forms Sveltia CMS writes). Empty values and empty lists are treated as absent.
 */
export function parseEntryFile(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(src);
  if (!m) throw new Error('missing front matter block (--- ... ---)');
  const props = SCHEMA.properties || {};
  const lines = m[1].split('\n');
  const obj = {};
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (isBlank(line) || line.trim().startsWith('#')) { i++; continue; }
    const km = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (!km) throw new Error(`bad front matter line: ${line}`);
    const key = km[1];
    const v = (km[2] || '').trim();
    let val;
    i++;
    if (/^[|>][+-]?$/.test(v)) {
      const r = readBlock(lines, i, v[0]);
      val = r.value; i = r.next;
    } else if (v[0] === '"' || v[0] === "'") {
      const r = readQuoted(lines, i - 1, v);
      val = r.value; i = r.next;
    } else if (v === '' || v[0] === '[') {
      if (v[0] === '[') {
        if (!v.endsWith(']')) throw new Error(`unterminated flow list for "${key}"`);
        val = v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '');
      } else {
        const items = [];
        while (i < lines.length && (isBlank(lines[i]) || /^[ \t]*-([ \t]|$)/.test(lines[i]))) {
          if (!isBlank(lines[i])) items.push(scalar(lines[i].replace(/^[ \t]*-[ \t]*/, '')));
          i++;
        }
        val = items.length ? items.filter((x) => x !== '') : '';
      }
    } else {
      val = v;
    }
    if (val === '' || (Array.isArray(val) && !val.length)) continue; // CMS writes empty optionals as '' / [] -> absent
    const type = props[key] && props[key].type;
    if (type === 'integer' && /^-?\d+$/.test(val)) obj[key] = Number(val);
    else if (type === 'boolean' && (val === 'true' || val === 'false')) obj[key] = val === 'true';
    else obj[key] = val;
  }
  obj.text = (m[2] || '').trim();
  return obj;
}

// ---------- validation (driven by the schema file) ----------

/** Validate an entry object against the schema; returns an array of error strings. */
export function validateEntry(obj) {
  const errs = [];
  const props = SCHEMA.properties || {};
  for (const k of SCHEMA.required || []) {
    if (obj[k] === undefined || obj[k] === '') errs.push(`missing required field "${k}"`);
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = props[k];
    if (!p) {
      if (SCHEMA.additionalProperties === false) errs.push(`unknown key "${k}"`);
      continue;
    }
    if (v === undefined || (v === '' && (SCHEMA.required || []).includes(k))) continue;
    if (p.type === 'array') {
      if (!Array.isArray(v)) { errs.push(`"${k}" must be a list`); continue; }
      const ip = p.items || {};
      v.forEach((it) => {
        if (typeof it !== 'string') errs.push(`"${k}" items must be strings`);
        else if (ip.pattern && !new RegExp(ip.pattern).test(it)) errs.push(`"${k}" item "${it}" does not match ${ip.pattern}`);
      });
      continue;
    }
    const typeOk = p.type === 'integer' ? Number.isInteger(v) : typeof v === p.type;
    if (!typeOk) { errs.push(`"${k}" must be ${p.type}`); continue; }
    if (p.enum && !p.enum.includes(v)) errs.push(`"${k}" must be one of: ${p.enum.join(', ')}`);
    if (typeof v === 'string') {
      if (p.minLength !== undefined && v.length < p.minLength) errs.push(`"${k}" shorter than ${p.minLength}`);
      if (p.maxLength !== undefined && v.length > p.maxLength) errs.push(`"${k}" longer than ${p.maxLength} (${v.length})`);
      if (p.pattern && !new RegExp(p.pattern).test(v)) errs.push(`"${k}" does not match ${p.pattern}`);
    }
    if (typeof v === 'number') {
      if (p.minimum !== undefined && v < p.minimum) errs.push(`"${k}" below minimum ${p.minimum}`);
      if (p.maximum !== undefined && v > p.maximum) errs.push(`"${k}" above maximum ${p.maximum}`);
    }
    if (k === 'ts' && typeof v === 'string' && Number.isNaN(Date.parse(v))) errs.push('"ts" is not a valid date-time');
  }
  return errs;
}

// ---------- time helpers ----------

/** Compact UTC timestamp YYYYMMDDTHHMMSSZ. */
export function compactTs(ts) {
  return new Date(ts).toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
}

/** Local date parts in the entry's own offset: { date: 'YYYY-MM-DD', dow: 'Mon' }. */
export function localParts(ts) {
  const m = /(Z|[+-])(\d{2})?:?(\d{2})?$/.exec(ts);
  let off = 0;
  if (m && m[1] !== 'Z') off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(Date.parse(ts) + off * 60000);
  return { date: d.toISOString().slice(0, 10), dow: DAYS[d.getUTCDay()] };
}

// ---------- rendering ----------

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Minimal safe markdown for the trace: escape everything, blank line = paragraph, newline = <br>. */
function traceHtml(t) {
  return t.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function rowHtml(e, handbookBase = '') {
  const min = e.minutes ? `<span class="log-min"> · ${e.minutes} min</span>` : '';
  const proof = e.proof ? `<a class="log-src" href="${esc(e.proof)}" rel="noopener noreferrer">Proof</a>` : '';
  const cards = (e.cards || []).map((id) => handbookBase
    ? `<a class="log-card-id" href="${esc(handbookBase)}#${esc(id.toLowerCase())}">${esc(id)}</a>`
    : `<span class="log-card-id">${esc(id)}</span>`).join('');
  const meta = `<span class="log-meta"><span class="badge-made badge-made-${slug(e.made)}">${esc(e.made)}</span>` +
    `<span class="log-track track-${slug(e.track)}">${esc(e.track)}</span>` +
    (cards ? `<span class="log-cards">${cards}</span>` : '') + `</span>`;
  const trace = e.trace ? `<details class="log-trace"><summary>Prompt trace</summary>${traceHtml(e.trace)}</details>` : '';
  return `<li class="log-row" id="e-${e.cts}"><span class="log-ep">Ep ${e.n}</span>` +
    `<time datetime="${esc(e.ts)}">${e.date} ${e.dow}</time>${meta}` +
    `<span class="log-note">${esc(e.text)}${min}${proof}</span>${trace}</li>`;
}

function between(html, startTag, endTag) {
  const a = html.indexOf(startTag), b = html.indexOf(endTag);
  if (a < 0 || b < a) throw new Error(`index.html: markers ${startTag} / ${endTag} not found`);
  return [a + startTag.length, b];
}

/** Start-here nav: exactly three links; the handbook link is omitted when handbook_base is empty. */
export function startHereHtml(base = '', home = false) {
  const items = [
    '    <li><a href="/OpenHorizon/">OpenHorizon</a></li>\n',
    base ? `    <li><a href="${esc(base)}">Handbook</a></li>\n` : '',
    '    <li><a href="https://github.com/axadream" rel="noopener noreferrer">GitHub</a></li>\n',
  ].join('');
  const more = home ? '<p class="start-more">What the labels mean, and all entries → <a href="/log/">/log/</a></p>\n' : '';
  return `<nav class="start-here" aria-label="Start here">\n  <ul>\n${items}  </ul>\n</nav>\n${more}`;
}

/** Static legend for the archive page only. Badge classes match the card badges. */
const LEGEND_HTML = `<section class="log-legend" aria-label="Legend">
    <dl>
      <div><dt><span class="badge-made badge-made-manual">Manual</span></dt><dd>I typed every line; AI may explain, never write. Proof: commit or test output.</dd></div>
      <div><dt><span class="badge-made badge-made-ai-guided">AI-guided</span></dt><dd>I wrote the spec and prompts; AI wrote the code. Proof: one prompt, one AI bug I caught.</dd></div>
      <div><dt><span class="badge-made badge-made-mixed">Mixed</span></dt><dd>The post states which part is which.</dd></div>
    </dl>
  </section>
`;

/** Open Graph / Twitter card tags plus the Atom alternate link. Inputs are plain text. */
export function metaTags({ title, desc, url, image, profile = false }) {
  const img = `https://alepax.com/assets/img/${image}`;
  return [
    `<meta property="og:type" content="${profile ? 'profile' : 'website'}">`,
    ...(profile ? ['<meta property="profile:first_name" content="Alex">', '<meta property="profile:last_name" content="Pintea">'] : []),
    '<meta property="og:site_name" content="Alex Pintea">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    '<link rel="alternate" type="application/atom+xml" title="Practice log" href="https://alepax.com/feed.xml">',
  ].join('\n');
}

const ld = (o) => `<script type="application/ld+json">\n${JSON.stringify(o).replace(/</g, '\\u003c')}\n</script>\n`;

const FEED_COUNT = 10;
const newestFirst = (list, n) => [...list].reverse().slice(0, n);

/** Atom 1.0 feed of the newest entries. Deterministic: `updated` is the newest entry timestamp. */
export function feedXml(entries) {
  const newest = newestFirst(entries, FEED_COUNT);
  const iso = (ts) => new Date(ts).toISOString();
  const updated = newest.length ? iso(newest[0].ts) : '1970-01-01T00:00:00.000Z';
  const items = newest.map((e) => {
    const url = `https://alepax.com/log/#e-${e.cts}`;
    return `  <entry>
    <id>${esc(url)}</id>
    <title>${esc(`Ep ${e.n} · ${e.track}`)}</title>
    <link href="${esc(url)}"/>
    <updated>${iso(e.ts)}</updated>
    <summary>${esc(e.text)}</summary>
  </entry>
`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://alepax.com/feed.xml</id>
  <title>Alex Pintea — practice log</title>
  <link rel="self" type="application/atom+xml" href="https://alepax.com/feed.xml"/>
  <link rel="alternate" type="text/html" href="https://alepax.com/log/"/>
  <updated>${updated}</updated>
  <author><name>Alex Pintea</name><uri>https://alepax.com/</uri></author>
${items}</feed>
`;
}

/** Shared page chrome taken from index.html: head template, header (nav fixed for sub-pages), footer. */
function chrome(index, { aboutCurrent = false } = {}) {
  const themeScript = (/<script>try\{var t=localStorage\.theme[\s\S]*?<\/script>/.exec(index) || [])[0];
  const header = (/<header class="site-header">[\s\S]*?<\/header>/.exec(index) || [])[0];
  const footer = (/<footer class="site-footer">[\s\S]*?<\/footer>/.exec(index) || [])[0];
  if (!themeScript || !header || !footer) throw new Error('index.html: theme script, header or footer not found');
  let nav = header.replace('href="#projects"', 'href="/#projects"').replace('href="#log"', aboutCurrent ? 'href="/log/"' : 'href="/#log"');
  if (aboutCurrent) { const navAbout = nav.replace('<a href="/about/">', '<a href="/about/" aria-current="page">'); if (navAbout === nav) throw new Error('index.html header: About link not found'); nav = navAbout; }
  // title/desc are plain text (escaped here); image is a file name under /assets/img/.
  const head = (title, desc, canonical, extra, image, profile = false) => {
  if (image === undefined) throw new Error('head(): image is required');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0F1115" id="tc">
<meta name="color-scheme" content="dark">
${themeScript}
${metaTags({ title, desc, url: canonical, image, profile })}
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/img/favicon.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/vendor/space-grotesk/SpaceGrotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
${extra}</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

${nav}

`;
  };
  return { head, footer };
}

const PERSON = { name: 'Alex Pintea', url: 'https://alepax.com/', sameAs: ['https://github.com/axadream', 'https://www.linkedin.com/in/alex-pintea'] };

/** Parse content/about.md into { jobTitle, paras[] }. Throws when jobTitle is missing or empty. */
export function parseAbout(text) {
  const o = parseEntryFile(text);
  if (!o.jobTitle || !String(o.jobTitle).trim()) throw new Error('content/about.md: jobTitle is required');
  const paras = o.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) throw new Error('content/about.md: empty body');
  return { jobTitle: o.jobTitle.trim(), paras };
}

function aboutHtml(index, about) {
  const { head, footer } = chrome(index, { aboutCurrent: true });
  if (about.paras.length < 5) throw new Error('content/about.md: expected title, location, 2 paragraphs, education');
  const [titleLine, location, p1, p2, edu] = about.paras;
  const first = p1.split(/(?<=\.)\s/)[0];
  const person = { '@context': 'https://schema.org', '@type': 'Person', ...PERSON, jobTitle: about.jobTitle };
  const page = { '@context': 'https://schema.org', '@type': 'ProfilePage', url: 'https://alepax.com/about/', mainEntity: { '@type': 'Person', name: PERSON.name, url: PERSON.url } };
  const tile = (href, title, text) => `      <a class="card about-tile" href="${href}"><h3>${title}</h3><p>${text}</p><span class="about-arrow" aria-hidden="true">→</span></a>\n`;
  return head('About — Alex Pintea', first, 'https://alepax.com/about/', ld(person) + ld(page), 'og-about.png', true) + `<main id="main">
  <section class="about-hero" aria-labelledby="about-name">
    <div class="wrap">
      <h1 id="about-name" class="about-name">Alex Pintea</h1>
      <p class="about-title">${esc(titleLine)}</p>
      <p class="about-loc">${esc(location)}</p>
    </div>
  </section>
  <div class="wrap about-body">
    <div class="about-grid">
      <div class="about-text">
        <p>${esc(p1)}</p>
        <p>${esc(p2)}</p>
      </div>
      <aside class="card about-facts" aria-label="Facts">
        <h2>Education</h2>
        <p>${esc(edu)}</p>
        <h2>Tracks</h2>
        <ul class="about-tracks">
          <li><span class="dot" style="background:var(--track-ai-study)" aria-hidden="true"></span>AI</li>
          <li><span class="dot" style="background:var(--track-math)" aria-hidden="true"></span>Math</li>
          <li><span class="dot" style="background:var(--track-3d)" aria-hidden="true"></span>3D</li>
        </ul>
      </aside>
    </div>
    <h2 class="about-h">Explore on this site</h2>
    <div class="about-tiles">
${tile('/OpenHorizon/', 'OpenHorizon', 'A shipped, installable PWA RSS reader.')}${tile('/log/', 'Engineering Log', 'Daily builds, experiments and code attribution.')}${tile('/AI_Engineering_Handbook/', 'AI Engineering Handbook', 'Open study notes, CC BY 4.0.')}    </div>
    <h2 class="about-h">Connect</h2>
    <div class="links about-connect">
      <a class="btn btn-secondary" href="https://github.com/axadream" rel="noopener">GitHub</a>
      <a class="btn btn-secondary" href="https://www.linkedin.com/in/alex-pintea" rel="noopener">LinkedIn</a>
      <a class="btn btn-secondary" href="#" data-email>Email</a>
    </div>
  </div>
</main>

${footer}

<script type="module" src="/assets/js/site.js"></script>
</body>
</html>
`;
}

function archiveHtml(index, entries, base) {
  const { head, footer } = chrome(index);
  const n = entries.length;
  const rows = [...entries].reverse().map((e) => `      ${rowHtml(e, base)}`).join('\n');
  const author = { '@type': 'Person', name: PERSON.name, url: PERSON.url };
  const blog = {
    '@context': 'https://schema.org', '@type': 'Blog', name: 'Practice log', url: 'https://alepax.com/log/', author,
    blogPost: newestFirst(entries, FEED_COUNT).map((e) => ({
      '@type': 'BlogPosting', headline: `Ep ${e.n} · ${e.track}`, url: `https://alepax.com/log/#e-${e.cts}`, datePublished: e.date, author,
    })),
  };
  return head('Log · alepax', `Archive of Alex Pintea's daily practice log: ${n} ${n === 1 ? 'entry' : 'entries'}.`, 'https://alepax.com/log/', ld(blog), 'og-log.png') + `<main id="main" class="wrap">
  <h1 class="section-title">Practice log</h1>
  ${startHereHtml(base)}  ${LEGEND_HTML}  <div class="card log-card">
    <p class="log-intro">Daily practice log. ${n} ${n === 1 ? 'entry' : 'entries'}.</p>
    <ol class="log-list">
${rows}
    </ol>
  </div>
</main>

${footer}

<script type="module" src="/assets/js/site.js"></script>
</body>
</html>
`;
}

// ---------- build ----------

/**
 * Render everything for the repo at `root`. Returns { outputs: {relPath: content}, stats, warnings }.
 * Does not write anything; see writeOutputs.
 */
export function build({ root = ROOT_DEFAULT } = {}) {
  const dir = join(root, 'content', 'log');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  const warnings = [];
  const valid = [];
  let invalid = 0, draft = 0;
  for (const f of files) {
    let obj;
    try { obj = parseEntryFile(readFileSync(join(dir, f), 'utf8')); } catch (e) {
      throw new Error(`content/log/${f}: front matter parse failure: ${e.message}`);
    }
    const errs = validateEntry(obj);
    if (errs.length) { errs.forEach((e) => warnings.push(`warn: ${f}: ${e}`)); invalid++; continue; }
    if (obj.draft === true) { draft++; continue; }
    valid.push(obj);
  }
  valid.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  valid.forEach((e, i) => Object.assign(e, { n: i + 1, cts: compactTs(e.ts) }, localParts(e.ts)));

  const newest = [...valid].reverse().slice(0, NODE_COUNT);
  let index = readFileSync(join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  // Footer year: newest year among valid non-draft log entries (as written in their ts local parts).
  // content/about.md has no date field, so it does not contribute. Deterministic: no mtimes, no git dates.
  const year = valid.length ? Math.max(...valid.map((x) => Number(x.date.slice(0, 4)))) : null;
  if (!/© \d{4} Alex Pintea/.test(index)) throw new Error('index.html: footer "© <year> Alex Pintea" not found');
  if (year) index = index.replace(/© \d{4} Alex Pintea/, `© ${year} Alex Pintea`);
  const [s, e] = between(index, '<!-- log:start -->\n', '<!-- log:end -->');
  const cfgPath = join(root, 'site.config.json');
  const base = existsSync(cfgPath) ? String(JSON.parse(readFileSync(cfgPath, 'utf8')).handbook_base || '').trim() : '';
  const home = newest.slice(0, HOME_COUNT);
  const homeRows = home.map((x) => `        ${rowHtml(x, base)}\n`).join('');
  const projects = JSON.parse(readFileSync(join(root, 'data', 'projects.json'), 'utf8'));
  const logNodes = newest.map((x) => {
    const t = x.text.length > LABEL_MAX ? x.text.slice(0, LABEL_MAX - 1) + '…' : x.text;
    const node = { id: `log-${x.cts}`, type: 'log', label: `Ep ${x.n} · ${x.date} · ${t}`, date: x.date, url: `/log/#e-${x.cts}` };
    node.track = slug(x.track);
    return node;
  });
  const nodes = [...projects, ...logNodes];

  // Site-map nav: one item per node, same order as nodes.json; log nodes link to /log/#e-<ts>.
  const mapRows = nodes.map((n) => {
    return `          <li><a href="${esc(n.url)}" data-node="${esc(n.id)}">${esc(n.label)}</a></li>\n`;
  }).join('');
  const aboutPath = join(root, 'content', 'about.md');
  const about = existsSync(aboutPath) ? parseAbout(readFileSync(aboutPath, 'utf8')) : null;
  let withLog = index.slice(0, s) + homeRows + index.slice(e);
  if (about) { let found = false; withLog = withLog.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, (block) => block.replace(/("jobTitle":)"(?:[^"\\]|\\.)*"/, (_, k) => { found = true; return k + JSON.stringify(about.jobTitle); })); if (!found) throw new Error('index.html: Person JSON-LD jobTitle not found'); }
  const [ss, se] = between(withLog, '<!-- start:start -->\n', '<!-- start:end -->');
  withLog = withLog.slice(0, ss) + startHereHtml(base, true) +withLog.slice(se);
  const [ms, me] = between(withLog, '<!-- sitemap:start -->\n', '<!-- sitemap:end -->');

  const outputs = {
    'index.html': withLog.slice(0, ms) + mapRows + withLog.slice(me),
    'log/index.html': archiveHtml(index, valid, base),
    'feed.xml': feedXml(valid),
    'data/nodes.json': '[\n' + nodes.map((n) => '  ' + JSON.stringify(n)).join(',\n') + '\n]\n',
  };
  const smPath = join(root, 'sitemap.xml');
  if (about) outputs['about/index.html'] = aboutHtml(index, about);
  if (existsSync(smPath)) {
    let sm = readFileSync(smPath, 'utf8').replace(/\r\n/g, '\n');
    const day = valid.length ? valid[valid.length - 1].date : null;
    // Appends a <url> before </urlset> unless its <loc> is already present; lastmod omitted when null.
    const addUrl = (loc, lastmod) => {
      if (sm.includes(`<loc>${loc}</loc>`)) return;
      const lm = lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '';
      const end = sm.indexOf('</urlset>');
      sm = sm.slice(0, end) + `  <url>\n    <loc>${loc}</loc>\n${lm}  </url>\n` + sm.slice(end);
    };
    if (about) addUrl('https://alepax.com/about/', day);
    addUrl('https://alepax.com/AI_Engineering_Handbook/', null);
    outputs['sitemap.xml'] = sm;
  }
  return {
    outputs,
    stats: { valid: valid.length, invalid, draft, home: home.length, archive: valid.length, projects: projects.length, logs: logNodes.length },
    warnings,
  };
}

/** Compare outputs to disk; returns relative paths that differ. */
export function outOfDate(root, outputs) {
  return Object.entries(outputs).filter(([p, c]) => {
    const f = join(root, p);
    return !existsSync(f) || readFileSync(f, 'utf8').replace(/\r\n/g, '\n') !== c;
  }).map(([p]) => p);
}

export function writeOutputs(root, outputs) {
  for (const [p, c] of Object.entries(outputs)) {
    const f = join(root, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c, 'utf8');
  }
}

function main() {
  const check = process.argv.includes('--check');
  const { outputs, stats: s, warnings } = build();
  warnings.forEach((w) => console.log(w));
  if (s.invalid && check) {
    console.log(`build-log: ${s.invalid} invalid entr${s.invalid === 1 ? 'y' : 'ies'}; failing`);
    process.exit(1);
  }
  if (check) {
    const stale = outOfDate(ROOT_DEFAULT, outputs);
    if (stale.length) {
      console.log('build-log: out of date:\n' + stale.map((p) => `  ${p}`).join('\n'));
      process.exit(1);
    }
    console.log('build-log: up to date');
    return;
  }
  writeOutputs(ROOT_DEFAULT, outputs);
  console.log(`build-log: ${s.valid} valid, ${s.invalid} invalid, ${s.draft} draft; home ${s.home}, archive ${s.archive}; nodes ${s.projects}+${s.logs}`);
  if (s.invalid) { console.log(`build-log: ${s.invalid} invalid entr${s.invalid === 1 ? 'y' : 'ies'}; failing`); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`build-log: ERROR ${e.message}`); process.exit(1); }
}
