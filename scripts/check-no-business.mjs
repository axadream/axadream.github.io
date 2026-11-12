#!/usr/bin/env node
// Guard: fails if commercial/ad terms or the reserved sub-project segment
// appear in the shipped repo. Terms are assembled from parts so this file
// does not contain them literally. Also checks version agreement, the
// reserved-section flags in site.config.json, and external hosts in shipped
// .html/.css/.js files. Node >= 18, no dependencies.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');

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

// Hosts that may appear in shipped .html/.css/.js files (archive/ and scripts/ excluded).
const allowedHosts = new Set([
  'alepax.com',
  'github.com',
  'www.linkedin.com',
  'schema.org',
  'www.w3.org',
]);

// Everything outside skipDirs is scanned, including data/ and all .json files.
const skipDirs = new Set(['.git', 'node_modules', '.claude', '_incoming', 'vendor']);
const hostSkipDirs = new Set(['archive', 'scripts', 'vendor']);
const hostExt = new Set(['.html', '.css', '.js']);
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

if (failures.length > 0) {
  for (const f of failures) console.log(f);
  console.log(`guard: FAIL (${failures.length} hit${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log(`guard: OK (${scanned} files scanned, version ${version})`);
process.exit(0);
