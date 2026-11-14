// build-log.mjs - generates the practice log from content/log/*.md.
//
// Usage:
//   node scripts/build-log.mjs           write outputs
//   node scripts/build-log.mjs --check   render in memory, exit 1 if any output is out of date
//
// Inputs : content/log/*.md, schema/log-entry.schema.json, data/projects.json, index.html
// Outputs: index.html (only between <!-- log:start --> and <!-- log:end -->),
//          log/index.html (fully generated), data/nodes.json
// Invalid entries are warnings (skipped, exit code 0). Drafts are skipped silently.
// Plain Node ESM, node: builtins only. Importing this module does not run the build.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOME_COUNT = 12;
const LABEL_MAX = 60;
const ROOT_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(ROOT_DEFAULT, 'schema', 'log-entry.schema.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- parsing ----------

/** Parse "---\nkey: value\n---\nbody" into an object; body becomes `text`. */
export function parseEntryFile(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(src);
  if (!m) throw new Error('missing front matter block (--- ... ---)');
  const props = SCHEMA.properties || {};
  const obj = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) throw new Error(`bad front matter line: ${line}`);
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    const q = /^(["'])([\s\S]*)\1$/.exec(val);
    if (q) val = q[2];
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

function rowHtml(e) {
  const min = e.minutes ? `<span class="log-min"> · ${e.minutes} min</span>` : '';
  const src = e.link ? `<a class="log-src" href="${esc(e.link)}" rel="noopener">Source</a>` : '';
  return `<li class="log-row" id="e-${e.cts}"><span class="log-ep">Ep ${e.n}</span>` +
    `<time datetime="${esc(e.ts)}">${e.date} ${e.dow}</time>` +
    `<span class="log-note">${esc(e.text)}${min}${src}</span></li>`;
}

function between(html, startTag, endTag) {
  const a = html.indexOf(startTag), b = html.indexOf(endTag);
  if (a < 0 || b < a) throw new Error(`index.html: markers ${startTag} / ${endTag} not found`);
  return [a + startTag.length, b];
}

function archiveHtml(index, entries) {
  const themeScript = (/<script>try\{var t=localStorage\.theme[\s\S]*?<\/script>/.exec(index) || [])[0];
  const header = (/<header class="site-header">[\s\S]*?<\/header>/.exec(index) || [])[0];
  const footer = (/<footer class="site-footer">[\s\S]*?<\/footer>/.exec(index) || [])[0];
  if (!themeScript || !header || !footer) throw new Error('index.html: theme script, header or footer not found');
  const nav = header.replace('href="#projects"', 'href="/#projects"').replace('href="#log"', 'href="/#log"');
  const n = entries.length;
  const rows = [...entries].reverse().map((e) => `      ${rowHtml(e)}`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log · alepax</title>
<meta name="description" content="Archive of Alex Pintea's daily practice log: ${n} ${n === 1 ? 'entry' : 'entries'}.">
<link rel="canonical" href="https://alepax.com/log/">
<meta name="theme-color" content="#0F1115" id="tc">
<meta name="color-scheme" content="dark">
${themeScript}
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/img/favicon.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/vendor/space-grotesk/SpaceGrotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

${nav}

<main id="main" class="wrap">
  <h1 class="section-title">Practice log</h1>
  <div class="card log-card">
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
      warnings.push(`warn: ${f}: ${e.message}`); invalid++; continue;
    }
    const errs = validateEntry(obj);
    if (errs.length) { errs.forEach((e) => warnings.push(`warn: ${f}: ${e}`)); invalid++; continue; }
    if (obj.draft === true) { draft++; continue; }
    valid.push(obj);
  }
  valid.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  valid.forEach((e, i) => Object.assign(e, { n: i + 1, cts: compactTs(e.ts) }, localParts(e.ts)));

  const newest = [...valid].reverse().slice(0, HOME_COUNT);
  const index = readFileSync(join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const [s, e] = between(index, '<!-- log:start -->\n', '<!-- log:end -->');
  const homeRows = newest.map((x) => `        ${rowHtml(x)}\n`).join('');
  const projects = JSON.parse(readFileSync(join(root, 'data', 'projects.json'), 'utf8'));
  const logNodes = newest.map((x) => {
    const t = x.text.length > LABEL_MAX ? x.text.slice(0, LABEL_MAX - 1) + '…' : x.text;
    const node = { id: `log-${x.cts}`, type: 'log', label: `Ep ${x.n} · ${x.date} · ${t}`, date: x.date, url: `/#e-${x.cts}` };
    if (x.project) node.project = x.project;
    return node;
  });
  const nodes = [...projects, ...logNodes];

  // Site-map nav: one item per node, same order as nodes.json; log nodes link to the on-page anchor.
  const mapRows = nodes.map((n) => {
    const href = n.type === 'log' ? n.url.replace(/^\//, '') : n.url;
    return `          <li><a href="${esc(href)}" data-node="${esc(n.id)}">${esc(n.label)}</a></li>\n`;
  }).join('');
  const withLog = index.slice(0, s) + homeRows + index.slice(e);
  const [ms, me] = between(withLog, '<!-- sitemap:start -->\n', '<!-- sitemap:end -->');

  return {
    outputs: {
      'index.html': withLog.slice(0, ms) + mapRows + withLog.slice(me),
      'log/index.html': archiveHtml(index, valid),
      'data/nodes.json': '[\n' + nodes.map((n) => '  ' + JSON.stringify(n)).join(',\n') + '\n]\n',
    },
    stats: { valid: valid.length, invalid, draft, home: newest.length, archive: valid.length, projects: projects.length, logs: logNodes.length },
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
