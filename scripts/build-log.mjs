// build-log.mjs - generates the practice log from content/log/*.md.
//
// Usage:
//   node scripts/build-log.mjs           write outputs
//   node scripts/build-log.mjs --check   render in memory, exit 1 if any output is out of date
//
// Inputs : content/log/*.md, schema/log-entry.schema.json, data/projects.json, index.html
// Outputs: index.html (only between <!-- log:start --> and <!-- log:end -->),
//          log/index.html (fully generated), data/nodes.json
// Schema-invalid entries are reported, skipped, and make the run exit 1. A front matter PARSE failure
// throws (exit 1, names the file). Drafts are skipped silently.
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

/** Atom 1.0 feed of non-draft entries, newest first. Deterministic: updated = newest entry ts. */
export function feedXml(entries) {
  const list = [...entries].reverse();
  const iso = (ts) => new Date(ts).toISOString().replace(/\.\d+Z$/, 'Z');
  const updated = list.length ? iso(list[0].ts) : '1970-01-01T00:00:00Z';
  const items = list.map((e) => {
    const proof = e.proof ? `<p><a href="${esc(e.proof)}">Proof</a></p>` : '';
    const html = `<p>${esc(e.text)}</p>${proof}`;
    return `  <entry>\n    <id>https://alepax.com/log/#e-${e.cts}</id>\n` +
      `    <title>${esc(`Ep ${e.n} · ${e.track} · ${e.made}`)}</title>\n` +
      `    <link rel="alternate" type="text/html" href="https://alepax.com/log/#e-${e.cts}"/>\n` +
      `    <updated>${iso(e.ts)}</updated>\n` +
      `    <content type="html">${esc(html)}</content>\n  </entry>\n`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <id>https://alepax.com/feed.xml</id>\n  <title>alepax log</title>\n` +
    `  <link rel="self" type="application/atom+xml" href="https://alepax.com/feed.xml"/>\n` +
    `  <link rel="alternate" type="text/html" href="https://alepax.com/log/"/>\n` +
    `  <updated>${updated}</updated>\n  <author><name>Alex Pintea</name></author>\n${items}</feed>\n`;
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

function archiveHtml(index, entries, base) {
  const themeScript = (/<script>try\{var t=localStorage\.theme[\s\S]*?<\/script>/.exec(index) || [])[0];
  const header = (/<header class="site-header">[\s\S]*?<\/header>/.exec(index) || [])[0];
  const footer = (/<footer class="site-footer">[\s\S]*?<\/footer>/.exec(index) || [])[0];
  if (!themeScript || !header || !footer) throw new Error('index.html: theme script, header or footer not found');
  const nav = header.replace('href="#projects"', 'href="/#projects"').replace('href="#log"', 'href="/#log"');
  const n = entries.length;
  const rows = [...entries].reverse().map((e) => `      ${rowHtml(e, base)}`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log · alepax</title>
<meta name="description" content="Archive of Alex Pintea's daily practice log: ${n} ${n === 1 ? 'entry' : 'entries'}.">
<link rel="canonical" href="https://alepax.com/log/">
<link rel="alternate" type="application/atom+xml" title="alepax log" href="/feed.xml">
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

  const newest = [...valid].reverse().slice(0, HOME_COUNT);
  const index = readFileSync(join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const [s, e] = between(index, '<!-- log:start -->\n', '<!-- log:end -->');
  const cfgPath = join(root, 'site.config.json');
  const base = existsSync(cfgPath) ? String(JSON.parse(readFileSync(cfgPath, 'utf8')).handbook_base || '').trim() : '';
  const homeRows = newest.map((x) => `        ${rowHtml(x, base)}\n`).join('');
  const projects = JSON.parse(readFileSync(join(root, 'data', 'projects.json'), 'utf8'));
  const logNodes = newest.map((x) => {
    const t = x.text.length > LABEL_MAX ? x.text.slice(0, LABEL_MAX - 1) + '…' : x.text;
    const node = { id: `log-${x.cts}`, type: 'log', label: `Ep ${x.n} · ${x.date} · ${t}`, date: x.date, url: `/#e-${x.cts}` };
    node.track = slug(x.track);
    return node;
  });
  const nodes = [...projects, ...logNodes];

  // Site-map nav: one item per node, same order as nodes.json; log nodes link to the on-page anchor.
  const mapRows = nodes.map((n) => {
    const href = n.type === 'log' ? n.url.replace(/^\//, '') : n.url;
    return `          <li><a href="${esc(href)}" data-node="${esc(n.id)}">${esc(n.label)}</a></li>\n`;
  }).join('');
  let withLog = index.slice(0, s) + homeRows + index.slice(e);
  const [ss, se] = between(withLog, '<!-- start:start -->\n', '<!-- start:end -->');
  withLog = withLog.slice(0, ss) + startHereHtml(base, true) +withLog.slice(se);
  const [ms, me] = between(withLog, '<!-- sitemap:start -->\n', '<!-- sitemap:end -->');

  return {
    outputs: {
      'index.html': withLog.slice(0, ms) + mapRows + withLog.slice(me),
      'log/index.html': archiveHtml(index, valid, base),
      'feed.xml': feedXml(valid),
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
