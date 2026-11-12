import { layout, days, project, R, H } from './graph-layout.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

/* Reveal on scroll */
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

/* Email assembled at runtime */
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

/* Smooth in-page anchors only when motion is allowed */
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

/* Site graph: SVG poster now, Three.js scene lazily */
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
    const add = (n, a) => {
      const e = document.createElementNS(NS, n);
      for (const k in a) e.setAttribute(k, a[k]);
      svg.append(e);
    };
    const P = L.nodes.map((n) => project(n.pos, 0));
    const rank = { older: 0, recent: 1, new: 2 };
    svg.replaceChildren();
    svg.setAttribute('viewBox', [-H, -H, 2 * H, 2 * H].join(' '));
    L.edges.forEach(([a, b]) => {
      const A = L.nodes[a].tier;
      const B = L.nodes[b].tier;
      add('line', { class: 'pe t-' + (rank[A] <= rank[B] ? A : B), x1: P[a].x, y1: -P[a].y, x2: P[b].x, y2: -P[b].y });
    });
    P.map((p, i) => i).sort((a, b) => P[a].z - P[b].z).forEach((i) => {
      const n = L.nodes[i];
      const r = R * n.size;
      if (n.tier === 'new') add('circle', { class: 'ph t-new', cx: P[i].x, cy: -P[i].y, r: r * 1.57, 'stroke-width': r * 0.26 });
      add('circle', { class: 'pn t-' + n.tier, cx: P[i].x, cy: -P[i].y, r });
    });
    const newest = L.nodes.reduce((m, n) => (n.date > m ? n.date : m), '');
    const d = Math.max(0, days(newest, now));
    const up = document.getElementById('graph-updated');
    if (up) up.textContent = 'Last update: ' + (d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago');
  } catch (e) { return; /* static fallback stays */ }
  if (navigator.connection?.saveData) return;
  const list = document.querySelector('nav[aria-label="Site map"]');
  let scene = null;
  let started = false;

  const start = async () => {
    try {
      const mod = await import('./hero-scene.js');
      scene = await mod.startScene(canvas, { layout: L, box, list, reducedMotion: reduced });
    } catch (e) { /* poster stays */ }
  };

  window.addEventListener('pagehide', () => {
    try { scene && scene.dispose(); } catch (e) { /* ignore */ }
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
