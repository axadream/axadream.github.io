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

/* Lazy hero scene */
(function () {
  const box = document.getElementById('hero-box');
  const canvas = document.getElementById('hero-canvas');
  if (reduced || navigator.connection?.saveData || !canvas || !box) return;
  let scene = null;
  let started = false;

  const start = async () => {
    try {
      const mod = await import('./hero-scene.js');
      scene = await mod.startScene(canvas, { reducedMotion: reduced });
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
