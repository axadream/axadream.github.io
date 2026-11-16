// Dev-only Open Graph image generator (renders assets/og/template.html with Playwright).
// Usage: node scripts/make-og.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startStaticServer, launchChromium } from './lib/playwright.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 61440;
const PAGES = [
	['home', 'Applied AI, math and 3D, built in public'],
	['about', 'Industrial IT & MES Consultant · Building in applied AI and 3D', { kicker: false }],
	['log', 'Practice log'],
	['work', 'Work'],
];

const { server, base } = await startStaticServer(ROOT);

const browser = await launchChromium(await loadPlaywright());

const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
let failed = 0;
for (const [t, title, opts = {}] of PAGES) {
	const kicker = opts.kicker === false ? '&kicker=0' : '';
	await page.goto(`${base}/assets/og/template.html?type=${encodeURIComponent(t)}&title=${encodeURIComponent(title)}${kicker}`);
	await page.evaluate(() => document.fonts.ready);
	const png = path.join(ROOT, 'assets', 'img', `og-${t}.png`);
	const jpg = path.join(ROOT, 'assets', 'img', `og-${t}.jpg`);
	let out = png;
	await page.screenshot({ path: png, type: 'png' });
	if (fs.statSync(png).size > MAX) {
		await page.screenshot({ path: jpg, type: 'jpeg', quality: 80 });
		fs.unlinkSync(png);
		out = jpg;
	} else if (fs.existsSync(jpg)) fs.unlinkSync(jpg);
	const size = fs.statSync(out).size;
	if (size > MAX) failed++;
	console.log(`${path.basename(out)} ${size} B`);
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
