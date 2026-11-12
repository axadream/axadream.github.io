#!/usr/bin/env node
// Guard: fails if commercial/ad terms or the reserved sub-project segment
// appear in the shipped repo. Terms are assembled from parts so this file
// does not contain them literally. Node >= 18, no dependencies.

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

// Everything outside skipDirs is scanned, including data/ and all .json files.
const skipDirs = new Set(['.git', 'node_modules', '.claude', '_incoming', 'vendor']);
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
  }
}

await walk(root);

if (failures.length > 0) {
  for (const f of failures) console.log(f);
  console.log(`guard: FAIL (${failures.length} hit${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log(`guard: OK (${scanned} files scanned)`);
process.exit(0);
