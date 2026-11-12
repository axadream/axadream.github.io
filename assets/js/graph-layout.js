// Shared by the SVG poster and the Three.js scene. Pure functions, no DOM.
export const R = 0.085; // node radius
export const H = 1.15; // half view extent
export const GR = 3.2; // glow radius in node radii
export const GA = 0.5; // glow alpha
export const SC = '#C9D6E8'; // stars

export const when = (n) => n.date || n.updated || '';
const newest = (a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0);

function selectNodes(nodes, max) {
	const p = nodes.filter((n) => n.type === 'project').sort(newest).slice(0, 6);
	const l = nodes.filter((n) => n.type === 'log').sort(newest).slice(0, Math.max(0, max - p.length));
	return p.concat(l);
}

export const fnv = (s) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
};
const mix = (h) => {
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	h ^= h >>> 16;
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	return (h ^ (h >>> 16)) >>> 0;
};

function hashPos(id) {
	const a = mix(fnv(id));
	const y = 1 - 2 * (a / 4294967296);
	const t = (mix(a ^ 0x9e3779b9) / 4294967296) * 6.283185307179586;
	const r = Math.sqrt(1 - y * y);
	return { x: r * Math.cos(t), y, z: r * Math.sin(t) };
}

export const stars = () => {
	let s = fnv('stars');
	const r = () => (s = mix((s + 0x9e3779b9) | 0)) / 4294967296;
	return Array.from({ length: 100 }, () => [(r() * 2 - 1) * H, (r() * 2 - 1) * H, 0.25 + r() * 0.5]);
};

function edges(ns) {
	const out = [];
	const idx = new Map(ns.map((n, i) => [n.id, i]));
	const ids = (t) => ns.map((n, i) => i).filter((i) => ns[i].type === t);
	const logs = ids('log').sort((a, b) => (ns[a].date < ns[b].date ? -1 : 1));
	const pr = ids('project');
	for (let k = 1; k < logs.length; k++) out.push([logs[k - 1], logs[k]]);
	for (let k = 1; k < pr.length; k++) out.push([pr[k - 1], pr[k]]);
	ns.forEach((n, i) => {
		if (n.type === 'log' && idx.has(n.project)) out.push([i, idx.get(n.project)]);
	});
	return out;
}

export const days = (d, now) => Math.floor((+now - Date.parse(d)) / 864e5);

function tier(d, now) {
	const n = days(d, now);
	return n <= 7 ? 'new' : n <= 30 ? 'recent' : 'older';
}

export function project(p, a) {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return { x: p.x * c + p.z * s, y: p.y, z: p.z * c - p.x * s };
}

export function layout(nodes, max, now) {
	const sel = selectNodes(nodes, max).map((n) => {
		const u = hashPos(n.id);
		const pj = n.type === 'project';
		const pl = n.status === 'planned';
		const r = pj ? 0.78 : 1;
		return {
			...n,
			pos: { x: u.x * r, y: u.y * r, z: u.z * r },
			tier: pl ? 'planned' : tier(when(n), now),
			size: pj ? 1 : 0.55,
			title: (n.title || n.label.split(' · ')[0]) + (pl ? ' (planned)' : ''),
			sub: pj ? (pl ? '' : 'updated ' + n.updated) : n.date,
		};
	});
	return { nodes: sel, edges: edges(sel) };
}
