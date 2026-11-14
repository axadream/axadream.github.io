import { project, fnv, stars, R, H, GR, GA, SC, isDrag, ambientOffset, clampToBox } from './graph-layout.js';
const K = {
	POINTER_RADIUS: 140,
	POINTER_PULL: 22,
	HOME_STIFFNESS: 90,
	DAMPING: 0.87, // velocity kept per 1/60 s
	REPULSION_RADIUS: 64,
	REPULSION_FORCE: 700, // px/s^2 at 0 distance
	EDGE_SPRING: 0.4, // neighbours follow this share
	DRAG_THRESHOLD: 5,
	HIT_RADIUS: 24,
	AMBIENT_AMP: 8, // px
	AMBIENT_PERIOD_MIN: 7, // s
	AMBIENT_PERIOD_MAX: 12,
	AMBIENT_Z: 0.08, // z wobble; ortho camera, so it drives scale/glow +-6%
	PARALLAX_DEG: 3,
	SCALE_MAX: 1.8,
	IDLE_FPS: 30,
	ACTIVE_FPS: 60,
	ENERGY_EPS: 0.05, // settled below this
};
const { min, max, hypot, exp, sin, cos } = Math;
const cl = (v, a, b) => min(b, max(a, v));
const sm = (a, b, x) => { x = cl((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const F = (n) => new Float32Array(n);
const mk = (t, c, x) => { const e = document.createElement(t); e.className = c; e.textContent = x; return e; };
export async function startScene(canvas, { layout: L, box, list, reducedMotion: rm, debug }) {
	const pr = document.createElement('canvas');
	if (!(pr.getContext('webgl2') || pr.getContext('webgl'))) return null;
	const T = await import('../../vendor/three.module.min.js');
	const cs = getComputedStyle(box);
	const css = (n, d) => new T.Color(cs.getPropertyValue(n).trim() || d);
	const tiers = { new: css('--tier-new', '#4FD1C5'), recent: css('--tier-recent', '#4A9DA0'), older: css('--tier-older', '#5E6A78'), planned: css('--tier-planned', '#4A5361') };
	const bg = css('--graph-bg', '#0B0E14');
	const white = new T.Color(1, 1, 1);
	const ns = L.nodes, E = L.edges, N = ns.length;
	const cols = ns.map((n) => tiers[n.tier]);
	const sz = ns.map((n) => R * n.size);
	const pln = ns.map((n) => n.tier === 'planned');
	const adj = ns.map(() => new Set());
	E.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
	const rings = [];
	ns.forEach((n, i) => { if (n.tier === 'new' || pln[i]) rings.push(i); });
	const lab = document.getElementById('graph-label') || document.createElement('div');
	const links = list ? [...list.querySelectorAll('a[data-node]')] : [];
	const rd = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
	rd.setPixelRatio(min(window.devicePixelRatio || 1, 2));
	rd.setClearColor(0, 0);
	const cam = new T.OrthographicCamera(-H, H, H, -H, 0.1, 10);
	cam.position.z = 5;
	const sc = new T.Scene();
	const add = T.AdditiveBlending;
	const sp = F(300), sk = F(300), c0 = new T.Color(SC);
	stars().forEach(([x, y, a], i) => { sp.set([x, y, -2], i * 3); sk.set([c0.r * a, c0.g * a, c0.b * a], i * 3); });
	const geo = (p, c) => {
		const g = new T.BufferGeometry();
		g.setAttribute('position', new T.BufferAttribute(p, 3));
		g.setAttribute('color', new T.BufferAttribute(c, 3));
		return g;
	};
	const pts = new T.Points(geo(sp, sk), new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, blending: add, depthWrite: false }));
	const gx = document.createElement('canvas');
	gx.width = gx.height = 64;
	const g2 = gx.getContext('2d');
	const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
	gr.addColorStop(0, `rgba(255,255,255,${GA})`);
	gr.addColorStop(1, 'rgba(255,255,255,0)');
	g2.fillStyle = gr;
	g2.fillRect(0, 0, 64, 64);
	const glow = new T.InstancedMesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(gx), transparent: true, blending: add, depthWrite: false }), N);
	const nodes = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), new T.MeshBasicMaterial(), N);
	const halo = new T.InstancedMesh(new T.RingGeometry(0.85, 1, 32), new T.MeshBasicMaterial({ transparent: true, blending: add, depthWrite: false, side: T.DoubleSide }), max(1, rings.length));
	halo.count = rings.length;
	const ep = F(E.length * 12), ec = F(E.length * 12);
	const eg = geo(ep, ec);
	const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ vertexColors: true }));
	[pts, lines, glow, nodes, halo].forEach((o) => { o.frustumCulled = false; sc.add(o); });
	// px from the box centre, y down: home h, sim q, velocity v, force a, drawn X Y
	const ox = F(N), oy = F(N); // per-node drag offset added to home, survives parallax and resize
	const hx = F(N), hy = F(N), qx = F(N), qy = F(N), vx = F(N), vy = F(N), ax = F(N), ay = F(N);
	const X = F(N), Y = F(N), Z = F(N), wp = F(N), pw = F(N), dm = F(N), hl = F(N), ss = F(N).fill(1);
	const p1 = ns.map((n) => (fnv(n.id) % 628) / 100), p2 = ns.map((n) => ((fnv(n.id) >>> 9) % 628) / 100);
	const om = ns.map((n) => 6.2832 / (K.AMBIENT_PERIOD_MIN + (((fnv(n.id) >>> 4) % 1000) / 1000) * (K.AMBIENT_PERIOD_MAX - K.AMBIENT_PERIOD_MIN)));
	const zz = F(N);
	const ed = F(E.length), eh = F(E.length), ne = F(E.length);
	const m4 = new T.Matrix4(), tc = new T.Color();
	let W = 1, Ht = 1, S = 1;
	let px = 0, py = 0, pin = false, pt = '', dn = -1, sx0 = 0, sy0 = 0, drag = false, sup = false, cp = -1, pz = false;
	let hov = -1, sel = -1, foc = -1, act = -1, ak = -1, en = rm ? 0 : 1;
	let lw = 0, lh = 0, t = 0, rx = 0, ry = 0, lr = 0, lastMove = -1e9;
	let raf = 0, inView = true, dead = false, init = true;
	const go = (i) => {
		const u = ns[i].url;
		if (u[0] === '#') {
			const el = document.querySelector(u);
			if (el) el.scrollIntoView({ behavior: rm ? 'auto' : 'smooth', block: 'start' });
			history.pushState(null, '', u);
		} else location.href = u;
	};
	const near = (r) => {
		let b = r * r, h = -1;
		for (let i = 0; i < N; i++) {
			const d = (X[i] - px) ** 2 + (Y[i] - py) ** 2;
			if (d < b) { b = d; h = i; }
		}
		return h;
	};
	const setLabel = () => {
		const n = ns[act];
		lab.classList.toggle('on', act >= 0);
		if (act >= 0) {
			lab.textContent = '';
			const s = document.createElement('span');
			s.append(mk('span', 'n', n.title), mk('span', 'd', n.sub));
			lab.append(s);
			if (act === sel) {
				const b = mk('button', 'go', 'Go');
				b.type = 'button';
				b.addEventListener('click', (e) => { e.stopPropagation(); go(sel); });
				lab.append(b);
			}
			lw = lab.offsetWidth;
			lh = lab.offsetHeight;
		}
		links.forEach((a) => a.classList.toggle('is-active', act >= 0 && a.dataset.node === n.id));
	};
	const fps = () => (pin || drag || en > K.ENERGY_EPS ? K.ACTIVE_FPS : K.IDLE_FPS);
	const frame = (now) => {
		raf = 0;
		if (dead) return;
		const live = !rm; // drift, parallax, pointer pull; physics always runs (drag + settle)
		if (live && lr && now - lr < 1000 / fps() - 4) { sched(); return; }
		const dt = lr ? min((now - lr) / 1000, 0.033) : 0.016;
		lr = now;
		t += dt;
		const k = live ? 1 - exp(-dt * 10) : 1;
		if (live) {
			const e = 1 - exp(-dt * 4);
			ry += ((pin ? cl(px / (W / 2), -1, 1) : 0) - ry) * e;
			rx += ((pin ? cl(py / (Ht / 2), -1, 1) : 0) - rx) * e;
		}
		const ra = (K.PARALLAX_DEG * Math.PI) / 180, cb = cos(rx * ra), sb = sin(rx * ra);
		for (let i = 0; i < N; i++) {
			const p = project(ns[i].pos, ry * ra);
			hx[i] = p.x * S;
			hy[i] = -(p.y * cb - p.z * sb) * S;
			Z[i] = p.z * cb + p.y * sb;
		}
		if (init) { init = false; qx.set(hx); qy.set(hy); }
		wp.fill(0);
		{
			const hk = K.HOME_STIFFNESS, ek = (hk * K.EDGE_SPRING) / (1 - K.EDGE_SPRING), df = K.DAMPING ** (dt * 60);
			for (let i = 0; i < N; i++) {
				if (drag && i === dn) { ox[i] = clampToBox(px, W / 2, 12) - hx[i]; oy[i] = clampToBox(py, Ht / 2, 12) - hy[i]; }
				let tx = hx[i] + ox[i], ty = hy[i] + oy[i];
				if (live && pin && !(drag && i === dn)) {
					const ex = px - hx[i], ey = py - hy[i], d = hypot(ex, ey) || 1;
					wp[i] = 1 - sm(0, K.POINTER_RADIUS, d);
					const m = min(d, K.POINTER_PULL) * wp[i];
					tx += (ex / d) * m;
					ty += (ey / d) * m;
				}
				ax[i] = (tx - qx[i]) * hk;
				ay[i] = (ty - qy[i]) * hk;
			}
			for (let i = 0; i < N; i++) {
				for (let j = i + 1; j < N; j++) {
					const dx = qx[i] - qx[j], dy = qy[i] - qy[j], d = hypot(dx, dy) || 0.01;
					const r = min(K.REPULSION_RADIUS, hypot(hx[i] - hx[j], hy[i] - hy[j]));
					if (d < r) {
						const f = (K.REPULSION_FORCE * (1 - d / r)) / d;
						ax[i] += dx * f; ay[i] += dy * f; ax[j] -= dx * f; ay[j] -= dy * f;
					}
				}
			}
			const o = (i) => (drag && i === dn ? 0 : 1); // a released node keeps its offset without edge pull-back
			E.forEach(([a, b]) => {
				const ux = ek * (qx[a] - hx[a] - o(a) * ox[a] - qx[b] + hx[b] + o(b) * ox[b]), uy = ek * (qy[a] - hy[a] - o(a) * oy[a] - qy[b] + hy[b] + o(b) * oy[b]);
				ax[a] -= ux; ay[a] -= uy; ax[b] += ux; ay[b] += uy;
			});
			en = 0;
			for (let i = 0; i < N; i++) {
				if (drag && i === dn) {
					const f = 1 - exp(-dt * 20);
					qx[i] += (cl(px, 12 - W / 2, W / 2 - 12) - qx[i]) * f;
					qy[i] += (cl(py, 12 - Ht / 2, Ht / 2 - 12) - qy[i]) * f;
					vx[i] = vy[i] = 0;
				} else {
					vx[i] = (vx[i] + ax[i] * dt) * df;
					vy[i] = (vy[i] + ay[i] * dt) * df;
					qx[i] += vx[i] * dt;
					qy[i] += vy[i] * dt;
				}
				en += vx[i] ** 2 + vy[i] ** 2 + (ax[i] / hk) ** 2 + (ay[i] / hk) ** 2;
			}
		}
		const am = live ? min(1, t / 1.5) : 0, w = now / 1000; // drift uses wall time, not the throttled dt
		for (let i = 0; i < N; i++) {
			X[i] = clampToBox(qx[i] + ambientOffset(w, om[i], p1[i], K.AMBIENT_AMP, am), W / 2, 12);
			Y[i] = clampToBox(qy[i] + ambientOffset(w, om[i] * 1.3, p2[i] * 2, K.AMBIENT_AMP, am), Ht / 2, 12);
			zz[i] = am * sin(om[i] * 0.6 * t + p1[i] + p2[i]);
			Z[i] += K.AMBIENT_Z * zz[i];
		}
		hov = pin && !drag ? near(K.HIT_RADIUS) : -1;
		act = drag ? dn : hov >= 0 ? hov : sel >= 0 ? sel : foc;
		box.classList.toggle('is-over-node', hov >= 0);
		box.classList.toggle('is-dragging', drag);
		const key = act * 2 + (act >= 0 && act === sel ? 1 : 0);
		if (key !== ak) { ak = key; setLabel(); }
		const nb = act >= 0 ? adj[act] : null;
		for (let i = 0; i < N; i++) {
			pw[i] = max(wp[i], i === act ? 1 : nb && nb.has(i) ? 0.35 : 0);
			ss[i] += (1 + (K.SCALE_MAX - 1) * pw[i] - ss[i]) * k;
		}
		const wx = (i) => X[i] / S, wy = (i) => -Y[i] / S;
		for (let i = 0; i < N; i++) {
			const on = act < 0 || i === act || nb.has(i);
			dm[i] += ((on ? 0 : 1) - dm[i]) * k;
			hl[i] += (pw[i] - hl[i]) * k;
			tc.copy(cols[i]).lerp(bg, 0.78 * dm[i]).lerp(white, 0.45 * hl[i] * (1 - dm[i]));
			nodes.setColorAt(i, tc);
			const zs = 1 + 0.75 * K.AMBIENT_Z * zz[i];
			const s = pln[i] ? 1e-4 : sz[i] * ss[i] * zs;
			nodes.setMatrixAt(i, m4.makeScale(s, s, s).setPosition(wx(i), wy(i), Z[i]));
			const g = pln[i] ? 1e-4 : sz[i] * ss[i] * GR * zs;
			glow.setMatrixAt(i, m4.makeScale(g, g, 1).setPosition(wx(i), wy(i), Z[i] - 0.03));
			glow.setColorAt(i, tc.copy(cols[i]).multiplyScalar((0.7 + 0.8 * hl[i] + 0.2 * zz[i]) * (1 - dm[i])));
		}
		const pl = live ? sin(t * 2) : 0;
		rings.forEach((i, j) => {
			const s = sz[i] * ss[i] * (pln[i] ? 1.1 : 1.7 * (1 + 0.12 * pl));
			halo.setMatrixAt(j, m4.makeScale(s, s, s).setPosition(wx(i), wy(i), Z[i] - 0.02));
			halo.setColorAt(j, tc.copy(cols[i]).multiplyScalar((pln[i] ? 1 : 0.55 * (1 + 0.3 * pl)) * (1 - dm[i])));
		});
		E.forEach(([a, b], e) => {
			const hit = act >= 0 && (a === act || b === act);
			ed[e] += ((act >= 0 && !hit ? 1 : 0) - ed[e]) * k;
			eh[e] += ((hit ? 1 : 0) - eh[e]) * k;
			const d = (i) => hypot(X[i] - px, Y[i] - py);
			ne[e] += ((live && pin ? max(1 - sm(0, 110, d(a)), 1 - sm(0, 110, d(b))) : 0) - ne[e]) * k;
			const h = max(eh[e], ne[e] * 0.7);
			const mx = (wx(a) + wx(b)) / 2, my = (wy(a) + wy(b)) / 2, mz = (Z[a] + Z[b]) / 2 - 0.01;
			ep.set([wx(a), wy(a), Z[a] - 0.01, mx, my, mz, mx, my, mz, wx(b), wy(b), Z[b] - 0.01], e * 12);
			for (let q = 0; q < 4; q++) {
				const mid = q === 1 || q === 2;
				tc.copy(cols[a]).lerp(cols[b], [0, 0.5, 0.5, 1][q]).lerp(bg, mid ? 0.45 - 0.3 * h : 0.85 - 0.5 * h).lerp(bg, 0.8 * ed[e]).lerp(white, 0.2 * eh[e]);
				ec.set([tc.r, tc.g, tc.b], e * 12 + q * 3);
			}
		});
		pts.position.set(-ry * 0.05, rx * 0.05, 0);
		eg.attributes.position.needsUpdate = true;
		eg.attributes.color.needsUpdate = true;
		[nodes, glow, halo].forEach((o) => {
			o.instanceMatrix.needsUpdate = true;
			if (o.instanceColor) o.instanceColor.needsUpdate = true;
		});
		if (act >= 0) {
			const r = sz[act] * ss[act] * S + 14, cx = W / 2 + X[act], cy = Ht / 2 + Y[act];
			let lx = cx + r;
			if (lx + lw > W - 6) lx = cx - r - lw;
			let ly = cy - r - lh;
			if (ly < 6) ly = cy + r;
			lab.style.transform = `translate(${cl(lx, 6, W - lw - 6).toFixed(1)}px,${cl(ly, 6, Ht - lh - 6).toFixed(1)}px)`;
		}
		rd.render(sc, cam);
		if (!canvas.classList.contains('is-ready')) {
			canvas.classList.add('is-ready');
			box.classList.add('scene-on');
		}
		if (live || drag || en > K.ENERGY_EPS) sched();
	};
	const sched = () => { if (!raf && !dead && !pz && inView && !document.hidden) raf = requestAnimationFrame(frame); };
	const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; lr = 0; };
	const resize = () => {
		W = box.clientWidth || 1;
		Ht = box.clientHeight || 1;
		rd.setSize(W, Ht, false);
		const S0 = S;
		S = min(W, Ht) / (2 * H);
		for (let i = 0; i < N; i++) { qx[i] *= S / S0; qy[i] *= S / S0; ox[i] *= S / S0; oy[i] *= S / S0; }
		cam.right = W / 2 / S;
		cam.left = -cam.right;
		cam.top = Ht / 2 / S;
		cam.bottom = -cam.top;
		cam.updateProjectionMatrix();
		sched();
	};
	const offs = [];
	const on = (el, ev, fn) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
	const rel = (e) => {
		const r = box.getBoundingClientRect();
		px = e.clientX - r.left - r.width / 2;
		py = e.clientY - r.top - r.height / 2;
	};
	on(box, 'pointermove', (e) => {
		const tch = e.pointerType === 'touch';
		if (tch && dn < 0) return;
		rel(e);
		if (!tch) pin = true;
		if (!tch || drag) sel = -1;
		lastMove = performance.now();
		if (dn >= 0 && !drag && isDrag(px - sx0, py - sy0, K.DRAG_THRESHOLD)) {
			drag = true;
			sel = -1;
			if (cp < 0) try { box.setPointerCapture(cp = e.pointerId); } catch (x) { /* ignore */ }
		}
		sched();
	});
	on(box, 'pointerleave', () => { pin = false; sched(); });
	on(box, 'pointerdown', (e) => {
		pt = e.pointerType;
		sup = false;
		dn = -1;
		if (lab.contains(e.target)) return;
		rel(e);
		sx0 = px;
		sy0 = py;
		dn = near(K.HIT_RADIUS);
		if (dn >= 0 && pt === 'touch') try { box.setPointerCapture(cp = e.pointerId); } catch (x) { /* ignore */ }
	});
	// touchstart on a node must not start a page pan; the tap is then resolved on pointerup (no click follows)
	const ts = (e) => {
		if (e.touches.length !== 1 || lab.contains(e.target)) return;
		rel(e.touches[0]);
		if (near(K.HIT_RADIUS) >= 0 && e.cancelable) e.preventDefault();
	};
	box.addEventListener('touchstart', ts, { passive: false });
	offs.push(() => box.removeEventListener('touchstart', ts));
	const up = (e) => {
		const tap = pt === 'touch' && !drag && dn >= 0;
		sup = drag;
		drag = false;
		dn = cp = -1;
		if (tap) { rel(e); lastMove = performance.now(); sel = near(K.HIT_RADIUS * 1.4); }
		sched();
	};
	const rs = () => {
		try { if (cp >= 0) box.releasePointerCapture(cp); } catch (x) { /* ignore */ }
		cp = dn = -1;
		drag = sup = pin = false;
		box.classList.remove('is-over-node', 'is-dragging');
	};
	on(box, 'pointerup', up);
	on(box, 'pointercancel', () => { rs(); sched(); });
	on(window, 'blur', rs);
	on(box, 'click', (e) => {
		if (sup) { sup = false; return; }
		rel(e);
		lastMove = performance.now();
		if (pt === 'touch') { sel = near(K.HIT_RADIUS * 1.4); sched(); return; }
		const i = near(K.HIT_RADIUS);
		if (i >= 0) go(i);
	});
	on(document, 'visibilitychange', () => { if (document.hidden) { rs(); stop(); } else sched(); });
	if (list) {
		on(list, 'focusin', (e) => { const a = e.target.closest('a[data-node]'); if (a) api.highlight(a.dataset.node); });
		on(list, 'focusout', () => api.highlight(null));
	}
	const ro = new ResizeObserver(resize);
	ro.observe(box);
	const io = new IntersectionObserver((es) => {
		inView = es.some((e) => e.isIntersecting);
		if (inView) sched(); else stop();
	});
	io.observe(box);
	resize();
	if (debug) window.__graph = { positions: () => ns.map((n, i) => [n.id, W / 2 + X[i], Ht / 2 + Y[i]]), energy: () => en, fps };
	const api = {
		highlight(id) {
			foc = id == null ? -1 : ns.findIndex((n) => n.id === id);
			lastMove = performance.now();
			sched();
		},
		pause() { pz = true; rs(); stop(); },
		resume() { pz = false; rs(); sched(); },
		dispose() {
			if (dead) return;
			dead = true;
			if (debug) delete window.__graph;
			stop();
			io.disconnect();
			ro.disconnect();
			offs.forEach((f) => f());
			rd.dispose();
			rd.forceContextLoss();
			box.classList.remove('is-over-node', 'is-dragging');
			lab.classList.remove('on');
		},
	};
	return api;
}
