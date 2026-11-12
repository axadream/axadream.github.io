import { layout, days, project, when, stars, R, H, GR, GA, SC } from './graph-layout.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const force = /[?&]motion=force\b/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
document.documentElement.classList.add('js');

(function () {
	const items = document.querySelectorAll('.reveal');
	if (reduced || !('IntersectionObserver' in window)) {
		items.forEach((el) => el.classList.add('is-visible'));
		return;
	}
	const io = new IntersectionObserver((entries) => {
		entries.forEach((e) => {
			if (e.isIntersecting) {
				e.target.classList.add('is-visible');
				io.unobserve(e.target);
			}
		});
	}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
	items.forEach((el) => io.observe(el));
})();

(function () {
	const a = document.getElementById('email-link');
	if (!a) return;
	const u = ['al', 'ex'].join('');
	const d = ['ale', 'pax', '.com'].join('');
	const addr = u + '@' + d;
	a.href = 'mailto:' + addr;
	a.textContent = 'Email';
	a.setAttribute('aria-label', 'Email ' + addr);
})();

(function () {
	const r = document.documentElement, b = document.getElementById('theme-toggle'), h = document.querySelector('.site-header');
	const set = (t) => {
		const l = t === 'light';
		r.dataset.theme = t;
		b.setAttribute('aria-pressed', l);
		b.setAttribute('aria-label', 'Switch to ' + (l ? 'dark' : 'light') + ' theme');
		document.getElementById('tc').content = l ? '#F5F7FA' : '#0F1115';
	};
	set(r.dataset.theme || 'dark');
	b.onclick = () => {
		const t = r.dataset.theme === 'light' ? 'dark' : 'light';
		set(t);
		try { localStorage.setItem('theme', t); } catch (e) { }
	};
	const sc = () => h.classList.toggle('is-scrolled', scrollY > 8);
	sc();
	addEventListener('scroll', sc, { passive: true });
	if (!('IntersectionObserver' in window)) return;
	const o = new IntersectionObserver((es) => es.forEach((e) => {
		if (!e.isIntersecting) return;
		document.querySelectorAll('.nav-list a').forEach((a) =>
			a.toggleAttribute('aria-current', a.hash === '#' + e.target.id) && a.setAttribute('aria-current', 'true'));
	}), { rootMargin: '-40% 0px -55% 0px' });
	document.querySelectorAll('#projects,#log').forEach((s) => o.observe(s));
})();

if (!reduced) {
	document.querySelectorAll('a[href^="#"]').forEach((a) => {
		a.addEventListener('click', (ev) => {
			const id = a.getAttribute('href');
			if (!id || id.length < 2) return;
			const t = document.querySelector(id);
			if (!t) return;
			ev.preventDefault();
			t.scrollIntoView({ behavior: 'smooth', block: 'start' });
			history.pushState(null, '', id);
		});
	});
}

(async function () {
	const box = document.getElementById('hero-box');
	const canvas = document.getElementById('hero-canvas');
	const svg = box && box.querySelector('.hero-poster');
	if (!canvas || !svg) return;
	let L;
	try {
		const [nodes, cfg] = await Promise.all(['data/nodes.json', 'site.config.json']
			.map((u) => fetch(u).then((r) => { if (!r.ok) throw 0; return r.json(); })));
		const now = Date.now();
		L = layout(nodes, cfg.graph.maxNodes, now);
		if (!L.nodes.length) return;
		const NS = 'http://www.w3.org/2000/svg';
		const add = (n, a, p = svg) => {
			const e = document.createElementNS(NS, n);
			for (const k in a) e.setAttribute(k, a[k]);
			p.append(e);
			return e;
		};
		const P = L.nodes.map((n) => project(n.pos, 0));
		svg.replaceChildren();
		svg.setAttribute('viewBox', [-H, -H, 2 * H, 2 * H].join(' '));
		const df = add('defs', {});
		['new', 'recent', 'older'].forEach((t) => {
			const g = add('radialGradient', { id: 'g-' + t, class: 't-' + t }, df);
			add('stop', { offset: 0, class: 'gs', 'stop-opacity': GA }, g);
			add('stop', { offset: 1, class: 'gs', 'stop-opacity': 0 }, g);
		});
		stars().forEach(([x, y, a]) => add('circle', { cx: x, cy: -y, r: 0.004, fill: SC, opacity: a }));
		L.edges.forEach(([a, b], e) => {
			const c = { x1: P[a].x, y1: -P[a].y, x2: P[b].x, y2: -P[b].y };
			const g = add('linearGradient', { id: 'e' + e, gradientUnits: 'userSpaceOnUse', ...c }, df);
			[[0, a, 0.15], [0.5, a, 0.55], [0.5, b, 0.55], [1, b, 0.15]].forEach(([o, n, v]) =>
				add('stop', { offset: o, class: 'gs t-' + L.nodes[n].tier, 'stop-opacity': v }, g));
			add('line', { stroke: `url(#e${e})`, 'stroke-width': 0.005, ...c });
		});
		P.map((p, i) => i).sort((a, b) => P[a].z - P[b].z).forEach((i) => {
			const n = L.nodes[i];
			const r = R * n.size;
			const c = { cx: P[i].x, cy: -P[i].y };
			const k = 't-' + n.tier;
			if (n.tier === 'planned') return add('circle', { class: 'pr ' + k, ...c, r: r * 1.02, 'stroke-width': r * 0.165 });
			add('circle', { ...c, r: r * GR, fill: `url(#g-${n.tier})` });
			if (n.tier === 'new') add('circle', { class: 'ph ' + k, ...c, r: r * 1.57, 'stroke-width': r * 0.26 });
			add('circle', { class: 'pn ' + k, ...c, r });
		});
		const newest = nodes.reduce((m, n) => (when(n) > m ? when(n) : m), '');
		const d = Math.max(0, days(newest, now));
		const up = document.getElementById('graph-updated');
		if (up) up.textContent = 'Last update: ' + (d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago');
	} catch (e) { return; }
	if (navigator.connection?.saveData) return;
	const list = document.querySelector('nav[aria-label="Site map"]');
	let scene = null;
	let started = false;

	const start = async () => {
		try {
			const mod = await import('./graph-scene.js');
			scene = await mod.startScene(canvas, { layout: L, box, list, reducedMotion: reduced && !force, debug: force });
		} catch (e) { }
	};

	window.addEventListener('pagehide', () => {
		try { scene && scene.dispose(); } catch (e) { }
		scene = null;
	});

	const arm = () => {
		if (!('IntersectionObserver' in window)) return;
		const io = new IntersectionObserver((entries) => {
			if (started || !entries.some((e) => e.isIntersecting)) return;
			started = true;
			io.disconnect();
			if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2000 });
			else setTimeout(start, 200);
		});
		io.observe(box);
	};

	if (document.readyState === 'complete') arm();
	else window.addEventListener('load', arm, { once: true });
})();
