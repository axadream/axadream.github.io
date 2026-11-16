// Shared Playwright helpers (dev tooling only): bare import, then the npx cache; a local static server; chromium launch.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };

export async function loadPlaywright() {
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

/**
 * Serves `root` on 127.0.0.1 with an ephemeral port. Returns { server, base } (base has no trailing slash).
 * indexDirs: a directory request is served as its index.html.
 * deny(u): true blocks the (decoded) request path, which then takes the notFound route.
 * notFound(res): handles every miss; defaults to an empty 404.
 */
export async function startStaticServer(root, { indexDirs = false, deny = () => false, notFound = (res) => { res.writeHead(404); res.end(); } } = {}) {
	const server = http.createServer((req, res) => {
		const u = decodeURIComponent(req.url.split('?')[0]);
		let f = path.join(root, u);
		if (!f.startsWith(root) || deny(u)) f = '';
		if (f && indexDirs && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
		if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
			res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
			return fs.createReadStream(f).pipe(res);
		}
		notFound(res);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Launches bundled Chromium, then installed Chrome, then Edge. Exits 2 when none starts. */
export async function launchChromium(playwright, extraOptions = {}) {
	for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
		try { return await playwright.chromium.launch({ ...o, ...extraOptions }); } catch (e) { /* try next */ }
	}
	console.error('no usable browser; run: npx --yes playwright@1.48.2 install chromium');
	process.exit(2);
}
