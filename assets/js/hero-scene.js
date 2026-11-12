import { project, R, H } from './graph-layout.js';

const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const F = (n) => new Float32Array(n);

export async function startScene(canvas, { layout: L, box, list, reducedMotion: rm }) {
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
  const T = await import('../../vendor/three.module.min.js');

  const cs = getComputedStyle(box);
  const css = (n, d) => new T.Color(cs.getPropertyValue(n).trim() || d);
  const tiers = { new: css('--tier-new', '#4FD1C5'), recent: css('--tier-recent', '#4A9DA0'), older: css('--tier-older', '#5E6A78') };
  const bg = css('--graph-bg', '#0B0E14');
  const white = new T.Color(1, 1, 1);
  const ns = L.nodes;
  const E = L.edges;
  const N = ns.length;
  const cols = ns.map((n) => tiers[n.tier]);
  const sz = ns.map((n) => R * n.size);
  const adj = ns.map(() => new Set());
  E.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
  const newIdx = [];
  ns.forEach((n, i) => { if (n.tier === 'new') newIdx.push(i); });
  const lab = document.getElementById('graph-label') || document.createElement('div');
  const links = list ? [...list.querySelectorAll('a[data-node]')] : [];

  const rd = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
  rd.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  rd.setClearColor(0, 0);
  const cam = new T.OrthographicCamera(-H, H, H, -H, 0.1, 10);
  cam.position.z = 5;
  const sc = new T.Scene();

  const gn = new T.IcosahedronGeometry(1, 1);
  const mn = new T.MeshBasicMaterial();
  const nodes = new T.InstancedMesh(gn, mn, N);
  const gh = new T.RingGeometry(0.85, 1, 32);
  const mh = new T.MeshBasicMaterial({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  const halo = new T.InstancedMesh(gh, mh, Math.max(1, newIdx.length));
  halo.count = newIdx.length;
  const ep = F(E.length * 6);
  const ec = F(E.length * 6);
  const eg = new T.BufferGeometry();
  eg.setAttribute('position', new T.BufferAttribute(ep, 3));
  eg.setAttribute('color', new T.BufferAttribute(ec, 3));
  const em = new T.LineBasicMaterial({ vertexColors: true });
  const lines = new T.LineSegments(eg, em);
  [lines, nodes, halo].forEach((o) => { o.frustumCulled = false; sc.add(o); });

  // per-node state (screen px relative to the box centre, y down)
  const X = F(N), Y = F(N), Z = F(N), dx = F(N), dy = F(N), vx = F(N), vy = F(N);
  const ss = F(N).fill(1), pw = F(N), dm = F(N), hl = F(N);
  const ed = F(E.length), eh = F(E.length);
  const m4 = new T.Matrix4();
  const tc = new T.Color();

  let W = 1, Ht = 1, S = 1;
  let px = 0, py = 0, pin = false, pt = '';
  let hov = -1, sel = -1, foc = -1, act = -1, ak = -1;
  let lw = 0, lh = 0, t = 0, rot = 0, lr = 0, lastMove = -1e9;
  let raf = 0, inView = true, dead = false, first = true;

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
      s.textContent = n.label;
      lab.append(s);
      if (act === sel) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'go';
        b.textContent = 'Go';
        b.addEventListener('click', (e) => { e.stopPropagation(); go(sel); });
        lab.append(b);
      }
      lw = lab.offsetWidth;
      lh = lab.offsetHeight;
    }
    links.forEach((a) => a.classList.toggle('is-active', act >= 0 && a.dataset.node === n.id));
  };

  const frame = (now) => {
    raf = 0;
    if (dead) return;
    const idle = !rm && now - lastMove > 1500;
    if (idle && now - lr < 32) { sched(); return; }
    const dt = lr ? Math.min((now - lr) / 1000, 0.1) : 0;
    lr = now;
    t += dt;
    if (!rm) rot += 0.08 * dt;
    const dr = rm ? 0 : Math.min(1, t / 1.5) * 0.012;
    for (let i = 0; i < N; i++) {
      const p = project(ns[i].pos, rot);
      const sx = (p.x + dr * Math.sin(t * 0.6 + i * 1.7)) * S;
      const sy = -(p.y + dr * Math.sin(t * 0.5 + i * 2.3)) * S;
      let w = 0, tx = 0, ty = 0;
      if (pin && !rm) {
        const ex = px - sx, ey = py - sy, d = Math.hypot(ex, ey) || 1;
        w = 1 - sm(0, 120, d);
        const m = Math.min(14, d) * w;
        tx = (ex / d) * m;
        ty = (ey / d) * m;
      }
      vx[i] = (vx[i] + (tx - dx[i]) * 0.12) * 0.78;
      vy[i] = (vy[i] + (ty - dy[i]) * 0.12) * 0.78;
      dx[i] += vx[i];
      dy[i] += vy[i];
      pw[i] = Math.max(w, i === act ? 1 : 0);
      ss[i] += (1 + 0.8 * pw[i] - ss[i]) * 0.2;
      X[i] = sx + dx[i];
      Y[i] = sy + dy[i];
      Z[i] = p.z;
    }
    const h = pin ? near(26) : -1;
    if (h !== hov) { hov = h; box.style.cursor = h < 0 ? '' : 'pointer'; }
    act = hov >= 0 ? hov : sel >= 0 ? sel : foc;
    const key = act * 2 + (act >= 0 && act === sel ? 1 : 0);
    if (key !== ak) { ak = key; setLabel(); }

    const k = rm ? 1 : 0.15;
    const nb = act >= 0 ? adj[act] : null;
    const wx = (i) => X[i] / S, wy = (i) => -Y[i] / S;
    for (let i = 0; i < N; i++) {
      const on = act < 0 || i === act || nb.has(i);
      dm[i] += ((on ? 0 : 1) - dm[i]) * k;
      hl[i] += (pw[i] - hl[i]) * k;
      tc.copy(cols[i]).lerp(bg, 0.78 * dm[i]).lerp(white, 0.45 * hl[i] * (1 - dm[i]));
      nodes.setColorAt(i, tc);
      const s = sz[i] * ss[i];
      nodes.setMatrixAt(i, m4.makeScale(s, s, s).setPosition(wx(i), wy(i), Z[i]));
    }
    const pl = Math.sin(t * 2) * (rm ? 0 : 1);
    newIdx.forEach((i, j) => {
      const s = sz[i] * ss[i] * 1.7 * (1 + 0.12 * pl);
      halo.setMatrixAt(j, m4.makeScale(s, s, s).setPosition(wx(i), wy(i), Z[i] - 0.02));
      halo.setColorAt(j, tc.copy(cols[i]).multiplyScalar(0.55 * (1 + 0.3 * pl) * (1 - dm[i])));
    });
    E.forEach(([a, b], e) => {
      const hit = act >= 0 && (a === act || b === act);
      ed[e] += ((act >= 0 && !hit ? 1 : 0) - ed[e]) * k;
      eh[e] += ((hit ? 1 : 0) - eh[e]) * k;
      ep.set([wx(a), wy(a), Z[a] - 0.01, wx(b), wy(b), Z[b] - 0.01], e * 6);
      [a, b].forEach((n, q) => {
        tc.copy(cols[n]).lerp(bg, 0.5 - 0.35 * eh[e]).lerp(bg, 0.8 * ed[e]).lerp(white, 0.2 * eh[e]);
        ec[e * 6 + q * 3] = tc.r;
        ec[e * 6 + q * 3 + 1] = tc.g;
        ec[e * 6 + q * 3 + 2] = tc.b;
      });
    });
    eg.attributes.position.needsUpdate = true;
    eg.attributes.color.needsUpdate = true;
    nodes.instanceMatrix.needsUpdate = true;
    nodes.instanceColor.needsUpdate = true;
    if (newIdx.length) {
      halo.instanceMatrix.needsUpdate = true;
      halo.instanceColor.needsUpdate = true;
    }
    if (act >= 0) {
      const r = sz[act] * ss[act] * S;
      const lx = Math.min(Math.max(W / 2 + X[act], lw / 2 + 6), W - lw / 2 - 6);
      let ly = Ht / 2 + Y[act] - r - 10;
      if (ly - lh < 6) ly = Ht / 2 + Y[act] + r + 10 + lh;
      lab.style.transform = `translate(${(lx - lw / 2).toFixed(1)}px,${(ly - lh).toFixed(1)}px)`;
    }
    rd.render(sc, cam);
    if (first) {
      first = false;
      canvas.classList.add('is-ready');
      box.classList.add('scene-on');
    }
    if (!rm) sched();
  };
  const sched = () => { if (!raf && !dead && inView && !document.hidden) raf = requestAnimationFrame(frame); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; lr = 0; };

  const resize = () => {
    W = box.clientWidth || 1;
    Ht = box.clientHeight || 1;
    rd.setSize(W, Ht, false);
    S = Math.min(W, Ht) / (2 * H);
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
    if (e.pointerType === 'touch') return;
    rel(e);
    pin = true;
    sel = -1;
    lastMove = performance.now();
    sched();
  });
  on(box, 'pointerleave', () => { pin = false; sched(); });
  on(box, 'pointerdown', (e) => { pt = e.pointerType; });
  on(box, 'click', (e) => {
    rel(e);
    lastMove = performance.now();
    if (pt === 'touch') { sel = near(32); sched(); return; }
    const i = near(26);
    if (i >= 0) go(i);
  });
  on(document, 'visibilitychange', () => (document.hidden ? stop() : sched()));
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

  const api = {
    highlight(id) {
      foc = id == null ? -1 : ns.findIndex((n) => n.id === id);
      lastMove = performance.now();
      sched();
    },
    dispose() {
      if (dead) return;
      dead = true;
      stop();
      io.disconnect();
      ro.disconnect();
      offs.forEach((f) => f());
      [gn, mn, gh, mh, eg, em].forEach((d) => d.dispose());
      nodes.dispose();
      halo.dispose();
      rd.dispose();
      rd.forceContextLoss();
      box.style.cursor = '';
      lab.classList.remove('on');
    },
  };
  return api;
}
