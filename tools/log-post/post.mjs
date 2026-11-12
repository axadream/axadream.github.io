#!/usr/bin/env node
// log-post: validate and post one practice-log entry to alepax.com
// (content/log/<name>.md on axadream/axadream.github.io, branch main).
// Standalone, Node 18+, node: builtins only. Copied to ~/.claude/skills/log-post/.
//
// Usage:
//   node post.mjs --text "..." --tag "Manual Code" [--minutes N] [--link URL]
//        [--project ID] [--draft] [--ts ISO] [--cwd DIR] [--dry] [--yes] [--json]
//   node post.mjs --flush        retry queued entries from pending/
//   node post.mjs --help
// Without --yes (and without --dry) it only previews and exits 3.
// Exit codes: 0 ok, 1 API error (4xx), 2 queued/offline, 3 preview only,
//             4 refused (allowlist/deny/validation/args), 5 token missing.
// Env: ALEPAX_LOG_TOKEN (fine-grained PAT), ALEPAX_LOG_HOME (config dir,
//      default ~/.alepax-log with allowed-projects.txt, deny-terms.txt, pending/).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, 'log-entry.schema.json'), 'utf8'));
const REPO = 'axadream/axadream.github.io';
const API = `https://api.github.com/repos/${REPO}/contents/content/log/`;

export const configDir = () => process.env.ALEPAX_LOG_HOME || path.join(os.homedir(), '.alepax-log');
const pendingDirDefault = () => path.join(configDir(), 'pending');

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Now as ISO 8601 with the local numeric offset, e.g. 2026-11-12T21:03:05+01:00. */
export function nowIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Build an entry object from parsed CLI args (only set keys that were given). */
export function buildEntry(args) {
  const e = { ts: args.ts || nowIso(), tag: args.tag, text: args.text };
  if (args.minutes !== undefined) e.minutes = /^-?\d+$/.test(String(args.minutes)) ? Number(args.minutes) : args.minutes;
  if (args.link !== undefined) e.link = args.link;
  if (args.project !== undefined) e.project = args.project;
  if (args.draft) e.draft = true;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

/** Validate against the schema; returns an array of error strings. */
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

function readLines(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

const normPath = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** Allowlist check: { ok, cwd, file, reason? }. */
export function checkAllow(cwd, home = configDir()) {
  const file = path.join(home, 'allowed-projects.txt');
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(file)) {
    return { ok: false, cwd: resolved, file, reason: `allowlist file not found; create it and add the line below` };
  }
  const c = normPath(cwd);
  for (const line of readLines(file)) {
    const a = normPath(line);
    if (c === a || c.startsWith(a.endsWith(path.sep) ? a : a + path.sep)) return { ok: true, cwd: resolved, file };
  }
  return { ok: false, cwd: resolved, file, reason: 'working directory is not in the allowlist' };
}

/** Deny-term check (case-insensitive substring over all string fields): { ok, term?, field? }. */
export function checkDeny(entry, home = configDir()) {
  const file = path.join(home, 'deny-terms.txt');
  if (!fs.existsSync(file)) return { ok: true };
  const terms = readLines(file);
  for (const [field, v] of Object.entries(entry)) {
    if (typeof v !== 'string') continue;
    const low = v.toLowerCase();
    for (const t of terms) if (low.includes(t.toLowerCase())) return { ok: false, term: t, field };
  }
  return { ok: true };
}

/** content/log file name: <UTC compact ts>-<8 hex of sha256(text)>.md */
export function fileName(entry) {
  const c = new Date(entry.ts).toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
  const h = crypto.createHash('sha256').update(entry.text, 'utf8').digest('hex').slice(0, 8);
  return `${c}-${h}.md`;
}

const yamlVal = (v) => {
  const s = String(v);
  return (s.includes(': ') || /^[\s"'#&*!|>%@`\[\]{}?,-]/.test(s) || /\s$/.test(s)) ? `"${s.replace(/"/g, "'")}"` : s;
};

/** Render the Markdown file with front matter. */
export function renderFile(entry) {
  const l = ['---', `ts: ${yamlVal(entry.ts)}`, `tag: ${yamlVal(entry.tag)}`];
  if (entry.minutes !== undefined) l.push(`minutes: ${entry.minutes}`);
  if (entry.link !== undefined) l.push(`link: ${yamlVal(entry.link)}`);
  if (entry.project !== undefined) l.push(`project: ${yamlVal(entry.project)}`);
  if (entry.draft) l.push('draft: true');
  l.push('---', '', String(entry.text), '');
  return l.join('\n');
}

const redact = (s, token) => (token && token.length >= 8 ? String(s).split(token).join('***') : String(s));
const headers = (token, put) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'alepax-log-post',
  ...(put ? { 'Content-Type': 'application/json' } : {}),
});
const compactOf = (ts) => new Date(ts).toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');

/** GET then PUT. Returns { code, status: posted|exists|queued|error|offline, message }. */
async function send({ name, file, ts, token, fetch: f }) {
  const doFetch = f || globalThis.fetch;
  const url = `${API}${name}`;
  try {
    const g = await doFetch(`${url}?ref=main`, { method: 'GET', headers: headers(token, false) });
    if (g.status === 200) return { code: 0, status: 'exists', message: `exists: content/log/${name} (nothing to do)` };
    if (g.status >= 500) return { code: 2, status: 'offline', message: `GitHub returned ${g.status}` };
    if (g.status !== 404) return { code: 1, status: 'error', message: `GET failed: ${g.status} ${await apiMsg(g)}` };
    const body = { message: `log: ${compactOf(ts)}`, content: Buffer.from(file, 'utf8').toString('base64'), branch: 'main' };
    const p = await doFetch(url, { method: 'PUT', headers: headers(token, true), body: JSON.stringify(body) });
    if (p.status === 201 || p.status === 200) {
      let html = '';
      try { const j = await p.json(); html = (j && j.content && j.content.html_url) || ''; } catch { /* ignore */ }
      return { code: 0, status: 'posted', message: `posted: content/log/${name}${html ? `\n${html}` : ''}` };
    }
    if (p.status >= 500) return { code: 2, status: 'offline', message: `GitHub returned ${p.status}` };
    return { code: 1, status: 'error', message: `PUT failed: ${p.status} ${await apiMsg(p)}` };
  } catch (err) {
    return { code: 2, status: 'offline', message: `network error: ${err && err.message}` };
  }
}

async function apiMsg(res) {
  try { const j = await res.json(); return (j && j.message) || ''; } catch { return ''; }
}

/** Post one entry; queue it in pendingDir on network failure or 5xx. */
export async function post({ entry, name, file, token, fetch: f, pendingDir = pendingDirDefault() }) {
  const r = await send({ name, file, ts: entry.ts, token, fetch: f });
  r.message = redact(r.message, token);
  if (r.status === 'offline') {
    fs.mkdirSync(pendingDir, { recursive: true });
    const p = path.join(pendingDir, `${name}.json`);
    fs.writeFileSync(p, JSON.stringify({ name, file, ts: entry.ts, savedAt: new Date().toISOString() }, null, 2) + '\n');
    return { code: 2, status: 'queued', path: p, message: `queued: ${p}; retry with: node post.mjs --flush` };
  }
  return r;
}

/** Retry every pending/*.json; delete on success, keep on network failure. */
export async function flush({ token, fetch: f, pendingDir = pendingDirDefault() }) {
  const out = { code: 0, posted: 0, exists: 0, kept: 0, failed: 0, lines: [] };
  const files = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter((n) => n.endsWith('.json')).sort() : [];
  for (const n of files) {
    const p = path.join(pendingDir, n);
    let item;
    try { item = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { out.failed++; out.lines.push(`skipped (unreadable): ${p}`); continue; }
    const r = await send({ name: item.name, file: item.file, ts: item.ts, token, fetch: f });
    const msg = redact(r.message, token).split('\n')[0];
    if (r.status === 'posted' || r.status === 'exists') {
      fs.unlinkSync(p);
      out[r.status]++;
    } else if (r.status === 'offline') out.kept++;
    else out.failed++;
    out.lines.push(msg);
  }
  out.lines.push(`flush: ${out.posted} posted, ${out.exists} existing, ${out.kept} kept, ${out.failed} failed`);
  out.code = out.kept + out.failed === 0 ? 0 : 2;
  return out;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const a = {};
  const val = new Set(['text', 'tag', 'minutes', 'link', 'project', 'ts', 'cwd']);
  const flag = new Set(['draft', 'dry', 'yes', 'flush', 'json', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument: ${argv[i]}`);
    if (flag.has(m[1])) a[m[1]] = true;
    else if (val.has(m[1])) {
      if (i + 1 >= argv.length) throw new Error(`--${m[1]} needs a value`);
      a[m[1]] = argv[++i];
    } else throw new Error(`unknown flag: ${argv[i]}`);
  }
  return a;
}

const HELP = `Usage: node post.mjs --text "..." --tag "Manual Code" [--minutes N] [--link URL]
       [--project ID] [--draft] [--ts ISO] [--cwd DIR] [--dry] [--yes] [--json]
       node post.mjs --flush
Without --yes the entry is only previewed (exit 3). --dry previews and exits 0.
Exit: 0 ok, 1 API error, 2 queued, 3 preview, 4 refused, 5 token missing.`;

const TOKEN_HELP = `ALEPAX_LOG_TOKEN is not set. Create a token:
  GitHub > Settings > Developer settings > Personal access tokens > Fine-grained > Generate new token
  Resource owner: axadream; Only select repositories: axadream.github.io
  Repository permissions: Contents = Read and write; Expiration: 90 days
Then in PowerShell: $env:ALEPAX_LOG_TOKEN = '<token>'`;

function preview(entry, name, file) {
  const o = (v) => (v === undefined ? '(none)' : v);
  return [
    'PREVIEW (nothing posted)',
    `  ts:       ${entry.ts}`,
    `  tag:      ${entry.tag}`,
    `  text:     ${entry.text}`,
    `  minutes:  ${o(entry.minutes)}`,
    `  link:     ${o(entry.link)}`,
    `  project:  ${o(entry.project)}`,
    `  draft:    ${entry.draft ? 'true' : 'false'}`,
    `  file:     content/log/${name}`,
    `  target:   ${REPO} @ main (GitHub Contents API)`,
    `To post exactly this, rerun with: --yes --ts ${entry.ts}`,
    '--- file ---',
    file,
  ].join('\n');
}

async function main() {
  const out = (s) => process.stdout.write(s + '\n');
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { out(`error: ${e.message}\n${HELP}`); return 4; }
  if (args.help) { out(HELP); return 0; }
  const token = process.env.ALEPAX_LOG_TOKEN || '';

  if (args.flush) {
    if (!token) { out(TOKEN_HELP); return 5; }
    const r = await flush({ token });
    r.lines.forEach(out);
    return r.code;
  }

  const entry = buildEntry(args);
  const fail = (code, errors) => {
    if (args.json) out(JSON.stringify({ ok: false, entry, name: null, file: null, errors }, null, 2));
    else out(`REFUSED (nothing posted)\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    return code;
  };

  const cwd = args.cwd || process.cwd();
  const allow = checkAllow(cwd);
  if (!allow.ok) {
    return fail(4, [
      `${allow.reason}`,
      `working directory: ${allow.cwd}`,
      `allowlist file:    ${allow.file}`,
      `to allow it, append this line to the allowlist: ${allow.cwd}`,
    ]);
  }
  const deny = checkDeny(entry);
  if (!deny.ok) return fail(4, [`deny term "${deny.term}" matched in field "${deny.field}"`]);
  const errors = validateEntry(entry);
  if (errors.length) return fail(4, errors);

  const name = fileName(entry);
  const file = renderFile(entry);
  if (args.json && (args.dry || !args.yes)) {
    out(JSON.stringify({ ok: true, entry, name, file, errors: [] }, null, 2));
    return args.dry ? 0 : 3;
  }
  if (args.dry || !args.yes) {
    out(preview(entry, name, file));
    return args.dry ? 0 : 3;
  }
  if (!token) { out(TOKEN_HELP); return 5; }
  const r = await post({ entry, name, file, token });
  if (args.json) out(JSON.stringify({ ok: r.code === 0, entry, name, file, errors: r.code === 0 ? [] : [r.message] }, null, 2));
  else out(r.message);
  return r.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => { process.exitCode = c; }, (e) => {
    process.stdout.write(`error: ${redact(e && e.message, process.env.ALEPAX_LOG_TOKEN)}\n`);
    process.exitCode = 1;
  });
}
