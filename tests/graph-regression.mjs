// Graph regression test (headless Chromium via Playwright, serves the repo itself).
// The hero graph loads only after the user clicks #graph-play (budget rule, guard "user-action load").
// Run: npx --yes playwright@1.48.2 install chromium   (once)
//      node tests/graph-regression.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };

async function loadPlaywright() {
	try { return await import('playwright'); } catch (e) { /* fall through */ }
	const dirs = [];
	const npx = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
	if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) dirs.push(path.join(npx, d, 'node_modules'));
	const extra = [...(process.env.PATH || '').split(path.delimiter), ...(process.env.NODE_PATH || '').split(path.delimiter)];
	for (const p of extra) if (p.includes('_npx')) dirs.push(p.endsWith('node_modules') ? p : path.join(p, 'node_modules'), path.join(p, '..', 'node_modules'));
	for (const d of dirs) {
		const f = path.join(d, 'playwright', 'index.mjs');
		if (fs.existsSync(f)) return import(pathToFileURL(f).href);
	}
	console.error('playwright not found. Run: npx --yes playwright@1.48.2 install chromium   then retry.');
	process.exit(2);
}

const server = http.createServer((req, res) => {
	const u = decodeURIComponent(req.url.split('?')[0]);
	let f = path.join(ROOT, u);
	if (!f.startsWith(ROOT) || u.startsWith('/OpenHorizon')) f = '';
	if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
	if (f && fs.existsSync(f)) {
		res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
		return fs.createReadStream(f).pipe(res);
	}
	res.writeHead(200, { 'content-type': 'text/html' });
	res.end('<!doctype html><title>stub</title><p>stub page</p>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await loadPlaywright();
// bfcache is enabled (Playwright disables it by default); fall back to installed Chrome/Edge if bundled Chromium cannot start.
let browser;
for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
	try { browser = await chromium.launch({ ...o, ignoreDefaultArgs: ['--disable-back-forward-cache'] }); break; } catch (e) { /* try next */ }
}
if (!browser) { console.error('no usable browser; run: npx --yes playwright@1.48.2 install chromium'); process.exit(2); }
let failed = 0;
const report = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = (page) => page.waitForFunction(() => !!window.__graph, null, { timeout: 8000 }).then(() => true, () => false);
// Clicks the Play button (skipped when it is already disabled, e.g. a bfcache restore of a started page), then waits for the graph.
const play = async (page) => {
	const btn = page.locator('#graph-play');
	if (await btn.isEnabled().catch(() => false)) await btn.click();
	return ready(page);
};
const pos = (page) => page.evaluate(() => Object.fromEntries(window.__graph.positions().map(([id, x, y]) => [id, [x, y]])));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const threeHits = (urls) => urls.filter((u) => u.includes('three.module')).length;

async function openPage(opts = {}, query = 'force') {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference', ...opts });
	const page = await ctx.newPage();
	const urls = [];
	page.on('request', (r) => urls.push(r.url()));
	await page.goto(base + '?motion=' + query); // 'reduce' = debug hook on, reduced motion honoured
	return { ctx, page, urls };
}

// Returns {id, client:[x,y]} for the node nearest to the box centre, using client coordinates.
async function target(page) {
	return page.evaluate(() => {
		const r = document.getElementById('hero-box').getBoundingClientRect();
		let best = null;
		for (const [id, x, y] of window.__graph.positions()) {
			const d = Math.hypot(x - r.width / 2, y - r.height / 2);
			if (!best || d < best.d) best = { id, d, client: [r.left + x, r.top + y] };
		}
		return best;
	});
}

async function dragNode(page, steps = 6, dx = 80) {
	const t = await target(page);
	const [x, y] = t.client;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y);
	await sleep(700);
	const after = (await pos(page))[t.id];
	const before = await page.evaluate((id) => { const r = document.getElementById('hero-box').getBoundingClientRect(); return [r.left, r.top]; }, t.id);
	await page.mouse.up();
	return { moved: dist([after[0] + before[0], after[1] + before[1]], t.client) };
}

try {
	// (E) user-action load: nothing from three.module before the click, exactly one request after it, and the graph runs
	{
		const { ctx, page, urls } = await openPage();
		await sleep(1500);
		const before = threeHits(urls);
		const up = await play(page);
		const after = threeHits(urls);
		report('E no three.module request before click', before === 0, `before=${before}`);
		report('E exactly one three.module request after click', up && after === 1, `graph=${up} after=${after}`);
		let moving = false;
		if (up) {
			await sleep(500);
			const p1 = await pos(page);
			await sleep(1000);
			const p2 = await pos(page);
			moving = Object.keys(p1).some((k) => dist(p1[k], p2[k]) > 0.05);
		}
		report('E graph runs after click', up && moving, `moving=${moving}`);
		await ctx.close();
	}

	// (A) back navigation after leaving to /OpenHorizon/
	{
		const { ctx, page } = await openPage();
		const up = await play(page);
		if (!up) report('A graph starts on fresh load', false, 'no __graph');
		else {
			await page.locator('a[href="/OpenHorizon/"]:visible').first().click();
			await page.waitForURL('**/OpenHorizon/');
			await page.goBack({ waitUntil: 'commit' }); // a bfcache restore fires no load event
			const alive = await play(page);
			let moving = false, gl = false;
			if (alive) {
				// The graph lives in its own section below the fold; the scene correctly pauses while off-screen.
				await page.locator('#hero-box').scrollIntoViewIfNeeded();
				await sleep(500);
				const p1 = await pos(page);
				await sleep(1000);
				const p2 = await pos(page);
				moving = Object.keys(p1).some((k) => dist(p1[k], p2[k]) > 0.05);
				gl = await page.evaluate(() => { const c = document.getElementById('hero-canvas'); const g = c.getContext('webgl2'); return !!g && !g.isContextLost(); });
			}
			report('A graph alive after back navigation', alive && moving && gl, `graph=${alive} moving=${moving} gl=${gl}`);
		}
		await ctx.close();
	}

	// (B) drag works after a reload
	{
		const { ctx, page } = await openPage();
		await play(page);
		await page.reload();
		const up = await play(page);
		let moved = 0;
		if (up) { await sleep(2000); moved = (await dragNode(page)).moved; }
		report('B drag works after reload', up && moved > 40, `moved=${moved.toFixed?.(1)}px`);
		await ctx.close();
	}

	// (C) clicking a node navigates
	{
		const { ctx, page } = await openPage();
		await play(page);
		await sleep(2000);
		const t = await target(page);
		const href0 = page.url();
		await page.mouse.move(...t.client);
		await page.mouse.down();
		await page.mouse.up();
		await sleep(600);
		report('C node click navigates', page.url() !== href0, `${href0} -> ${page.url()}`);
		await ctx.close();
	}

	// (D) reduced motion: no drift, drag still works, node stays put, loop goes idle
	{
		const { ctx, page } = await openPage({ reducedMotion: 'reduce' }, 'reduce');
		const up = await play(page);
		let still = 99, moved = 0, kept = 99, en = -1;
		if (up) {
			await sleep(1500);
			const p1 = await pos(page);
			await sleep(1500);
			const p2 = await pos(page);
			still = Math.max(...Object.keys(p1).map((k) => dist(p1[k], p2[k])));
			const t = await target(page);
			const box = await page.evaluate(() => { const r = document.getElementById('hero-box').getBoundingClientRect(); return [r.left, r.top]; });
			const [x, y] = t.client;
			await page.mouse.move(x, y);
			await page.mouse.down();
			for (let i = 1; i <= 6; i++) await page.mouse.move(x + (80 * i) / 6, y);
			await sleep(500);
			await page.mouse.up();
			await sleep(1200);
			const a = (await pos(page))[t.id];
			moved = dist([a[0] + box[0], a[1] + box[1]], t.client);
			await sleep(1500);
			const b = (await pos(page))[t.id];
			kept = dist(a, b);
			en = await page.evaluate(() => window.__graph.energy());
		}
		report('D reduced motion: no drift, drag works and stays', up && still < 0.05 && moved > 40 && kept < 0.5 && en < 0.05, `still=${still.toFixed?.(2)} moved=${moved.toFixed?.(1)} kept=${kept.toFixed?.(2)} energy=${en}`);
		await ctx.close();
	}

	// (F) Play -> Running state; Reload rebuilds the scene (positions change) without a second three.module request
	{
		const { ctx, page, urls } = await openPage();
		await page.locator('#graph-play').click();
		const up = await ready(page);
		await sleep(500);
		const state = await page.evaluate(() => ({ text: document.getElementById('graph-play').textContent.trim(), pressed: document.getElementById('graph-play').getAttribute('aria-pressed'), reloadVisible: !document.getElementById('graph-reload').hidden }));
		report('F Play shows Running, pressed, Reload visible', up && state.text === 'Running' && state.pressed === 'true' && state.reloadVisible, JSON.stringify(state));
		const p0 = up ? await pos(page) : {};
		await page.locator('#graph-reload').click();
		await sleep(300);
		const up2 = await ready(page);
		await sleep(500);
		const p1 = up2 ? await pos(page) : {};
		const changed = Object.keys(p0).filter((k) => p1[k] && dist(p0[k], p1[k]) > 0.05).length;
		report('F Reload rebuilds: at least one node position changed', up2 && changed >= 1, `graph=${up2} changed=${changed}`);
		const three = threeHits(urls);
		report('F exactly one three.module request after Reload', three === 1, `three=${three}`);
		await ctx.close();
	}
	// (G) reduced-motion note after Play (1280x800); with motion allowed the label stays empty and the graph drifts
	{
		const MSG = 'Motion reduced by your system setting; drag still works';
		const label = (page) => page.evaluate(() => (document.getElementById('graph-label')?.textContent || '').trim());
		const vp = { width: 1280, height: 800 };
		const r = await openPage({ reducedMotion: 'reduce', viewport: vp }, 'reduce');
		const upR = await play(r.page);
		await sleep(300);
		const textR = upR ? await label(r.page) : '<no graph>';
		report('G reduced motion: label shows the note after Play', upR && textR === MSG, `label=${JSON.stringify(textR)}`);
		await r.ctx.close();

		const o = await openPage({ reducedMotion: 'no-preference', viewport: vp }, 'force');
		const upO = await play(o.page);
		await sleep(300);
		const textO = upO ? await label(o.page) : '<no graph>';
		const q0 = upO ? await pos(o.page) : {};
		await sleep(3000);
		const q1 = upO ? await pos(o.page) : {};
		const disp = Math.max(0, ...Object.keys(q0).map((k) => (q1[k] ? dist(q0[k], q1[k]) : 0)));
		report('G motion allowed: label empty and nodes drift >2px in 3 s', upO && textO === '' && disp > 2, `label=${JSON.stringify(textO)} disp=${disp.toFixed(1)}px`);
		await o.ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}
process.exit(failed ? 1 : 0);
