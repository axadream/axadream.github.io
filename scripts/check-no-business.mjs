#!/usr/bin/env node
// Guard: fails if commercial/ad terms or the reserved sub-project segment
// appear in the shipped repo. Terms are assembled from parts so this file
// does not contain them literally. Also checks version agreement, the
// reserved-section flags in site.config.json, external hosts in shipped
// .html/.css/.js files, log entry validity, build-log freshness, and the
// admin/ host allowlist, and that graph chunks load only behind a user action.
// Node >= 18, no dependencies.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { parseEntryFile, validateEntry } from './build-log.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const strict = process.argv.includes('--strict');

const terms = [
  ['al', 'mixt'],
  ['affil', 'iate'],
  ['spons', 'ored'],
  ['ad', 'sense'],
  ['google', 'tagmanager'],
  ['double', 'click.net'],
  ['amazon-', 'adsystem'],
  ['media', '.net'],
  ['tabo', 'ola'],
  ['out', 'brain'],
].map((p) => p.join('').toLowerCase());

const reservedSegment = ['Open', 'Horizon'].join('').toLowerCase();

// Hosts that may appear in shipped .html/.css/.js files (archive/, scripts/, admin/ excluded).
const allowedHosts = new Set([
  'alepax.com',
  'github.com',
  'www.linkedin.com',
  'schema.org',
  'www.w3.org',
]);

// Hosts that the self-hosted CMS under admin/ may reference (check 8).
const adminAllowedHosts = new Set([
  'api.github.com',
  'github.com',
  'avatars.githubusercontent.com',
  'raw.githubusercontent.com',
  'alepax.com',
]);

// Everything outside skipDirs is scanned, including data/ and all .json files.
const skipDirs = new Set(['.git', 'node_modules', '.claude', '_incoming', 'vendor']);
const hostSkipDirs = new Set(['archive', 'scripts', 'vendor', 'admin']);
const hostExt = new Set(['.html', '.css', '.js']);
const adminExt = new Set(['.html', '.yml', '.webmanifest', '.json']);
const binaryExt = new Set(['.png', '.webp', '.jpg', '.ico', '.woff2']);

const failures = [];
let scanned = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;

    const segments = rel.split(sep).map((s) => s.toLowerCase());
    if (segments.includes(reservedSegment)) {
      failures.push(`${rel}: path contains reserved segment "${reservedSegment}"`);
    }

    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (binaryExt.has(ext)) continue;

    const text = await readFile(full, 'utf8');
    scanned++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      for (const term of terms) {
        if (lower.includes(term)) {
          failures.push(`${rel}:${i + 1}: ${term}`);
        }
      }
    }

    // External host check: shipped html/css/js only.
    if (hostExt.has(ext) && !hostSkipDirs.has(segments[0])) {
      const urlRe = /https?:\/\/([^/\s"'<>()`\\]+)/gi;
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(urlRe)) {
          const host = m[1].toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
          if (host && !allowedHosts.has(host)) {
            failures.push(`${rel}:${i + 1}: external host not allowed: ${m[0]}`);
          }
        }
      }
    }

    // Admin host allowlist (8): backslashes are stripped so YAML regex escapes
    // such as github\.com are read as the host they name.
    if (adminExt.has(ext) && segments[0] === 'admin') {
      const urlRe = /https?:\/\/([^/\s"'<>()`;,]+)/gi;
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].replace(/\\/g, '').matchAll(urlRe)) {
          const host = m[1].toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
          if (host && !adminAllowedHosts.has(host)) {
            failures.push(`${rel}:${i + 1}: admin host not allowed: ${m[0]}`);
          }
        }
      }
    }
  }
}

await walk(root);

// Version agreement and config flags.
let version = null;
try {
  const config = JSON.parse(await readFile(join(root, 'site.config.json'), 'utf8'));
  version = config.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push(`site.config.json: version "${version}" is not semver x.y.z`);
  }
  if (config.threeDWork !== false) {
    failures.push('site.config.json: threeDWork must be exactly false');
  }
  if (config.lab !== false) {
    failures.push('site.config.json: lab must be exactly false');
  }
} catch (e) {
  failures.push(`site.config.json: cannot read or parse (${e.message})`);
}

try {
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  if (!m) {
    failures.push('CHANGELOG.md: no "## [x.y.z]" heading found');
  } else if (m[1] !== version) {
    failures.push(`version mismatch: site.config.json has ${version}, CHANGELOG.md has ${m[1]}`);
  }
} catch (e) {
  failures.push(`CHANGELOG.md: cannot read (${e.message})`);
}

try {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const p = html.match(/<p class="foot-ver"[^>]*>([\s\S]*?)<\/p>/);
  const v = p && p[1].match(/v(\d+\.\d+\.\d+)/);
  if (!v) {
    failures.push('index.html: no v<semver> inside the .foot-ver paragraph');
  } else if (v[1] !== version) {
    failures.push(`version mismatch: site.config.json has ${version}, index.html footer has ${v[1]}`);
  }
} catch (e) {
  failures.push(`index.html: cannot read (${e.message})`);
}

// JS budget (5): per page: first-party gzipped JS <= 12,288 B, and no chunk may load
// without a user action. Counts gzipped first-party JS plus the classic inline <script> in <head>.
const JS_GZIP_BUDGET = 12288;
const JS_RAW_WARN = 24000;
try {
  const parts = [];
  for (const f of ['assets/js/site.js', 'assets/js/graph-layout.js', 'assets/js/graph-scene.js']) {
    parts.push(await readFile(join(root, f), 'utf8'));
  }
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  for (const m of head.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/\ssrc=/i.test(attrs)) continue;
    const type = (attrs.match(/\stype=["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text|application)\/javascript$/i.test(type)) continue;
    parts.push(m[2]);
  }
  const gz = parts.reduce((n, s) => n + gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length, 0);
  const raw = parts.reduce((n, s) => n + Buffer.byteLength(s, 'utf8'), 0);
  console.log(`guard: js gzipped ${gz} B of ${JS_GZIP_BUDGET} B (raw ${raw} B)`);
  if (gz > JS_GZIP_BUDGET) {
    failures.push(
      `js budget: per page first-party gzipped JS is ${gz} B, over the ${JS_GZIP_BUDGET} B (12,288 B) limit`
    );
  }
  if (raw > JS_RAW_WARN) {
    console.log(`WARNING: js raw ${raw} B exceeds ${JS_RAW_WARN} B (warning only)`);
  }
} catch (e) {
  failures.push(`js budget: cannot read sources (${e.message})`);
}

// Load gate (8): per page, no chunk may load without a user action. index.html must
// not reference the graph chunks at all; assets/js/site.js may reference them only on
// a line carrying the /* user-action-load */ marker.
const LAZY_REFS = ['graph-scene.js', 'three.module'];
const LAZY_MARKER = '/* user-action-load */';
try {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  for (const ref of LAZY_REFS) {
    if (html.includes(ref)) {
      failures.push(`user-action load: index.html references ${ref}; chunks may load only after a user action`);
    }
  }
  const siteJs = await readFile(join(root, 'assets', 'js', 'site.js'), 'utf8');
  let refLines = 0;
  siteJs.split(/\r?\n/).forEach((line, i) => {
    if (!LAZY_REFS.some((ref) => line.includes(ref))) return;
    refLines++;
    if (!line.includes(LAZY_MARKER)) {
      failures.push(`user-action load: assets/js/site.js line ${i + 1} references a lazy chunk without ${LAZY_MARKER}`);
    }
  });
  if (refLines === 0) {
    failures.push('user-action load: assets/js/site.js has no reference to graph-scene.js or three.module (graph not wired)');
  }
} catch (e) {
  failures.push(`user-action load: cannot read sources (${e.message})`);
}

// Log entries (6): every content/log/*.md must parse and validate against the schema.
try {
  const logDir = join(root, 'content', 'log');
  const logFiles = (await readdir(logDir)).filter((f) => f.endsWith('.md')).sort();
  for (const f of logFiles) {
    let errs;
    try {
      errs = validateEntry(parseEntryFile(await readFile(join(logDir, f), 'utf8')));
    } catch (e) {
      errs = [e.message];
    }
    for (const err of errs) failures.push(`content/log/${f}: ${err}`);
  }
} catch (e) {
  failures.push(`content/log: cannot read (${e.message})`);
}

// Build freshness (7): generated log outputs must match a fresh build.
{
  const check = spawnSync(process.execPath, [join(root, 'scripts', 'build-log.mjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (check.status !== 0) {
    const stdout = check.stdout || '';
    const staleOnly = check.status === 1 && /build-log: out of date/.test(stdout);
    if (staleOnly && !strict) {
      const stale = stdout
        .split(/\r?\n/)
        .filter((l) => /^ {2}\S/.test(l))
        .map((l) => l.trim())
        .join(', ');
      console.log(
        'guard: WARN build outputs stale (index.html, log/index.html, data/nodes.json may be out of date; run node scripts/build-log.mjs). CI regenerates them.' +
          (stale ? ` Stale: ${stale}.` : '')
      );
    } else {
      const out = `${stdout}${check.stderr || ''}`.trim().replace(/\s*\r?\n\s*/g, ' | ');
      failures.push(`build up to date: node scripts/build-log.mjs --check exited ${check.status}: ${out}`);
    }
  }
}

if (failures.length > 0) {
  for (const f of failures) console.log(f);
  console.log(`guard: FAIL (${failures.length} hit${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log(`guard: OK (${scanned} files scanned, version ${version})`);
process.exit(0);
