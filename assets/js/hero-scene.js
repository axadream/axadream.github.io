export async function startScene(canvas, { reducedMotion } = {}) {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) return null;

  const THREE = await import('../../vendor/three.module.min.js');
  const box = canvas.parentElement;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4FD1C5';
  const color = new THREE.Color(accent);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.z = 4.2;
  const group = new THREE.Group();
  scene.add(group);

  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // Icosphere wireframe
  const ico = track(new THREE.IcosahedronGeometry(1, 1));
  const wire = track(new THREE.WireframeGeometry(ico));
  const wireMat = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  group.add(new THREE.LineSegments(wire, wireMat));

  const ptsMat = track(new THREE.PointsMaterial({ color, size: 0.04, sizeAttenuation: true }));
  group.add(new THREE.Points(ico, ptsMat));

  // Extra points on a slightly larger sphere, linked to 2 nearest neighbours
  const N = window.innerWidth >= 768 ? 90 : 40;
  const pos = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) * 2 / N;
    const r = Math.sqrt(1 - y * y);
    const t = i * 2.399963229728653;
    pos.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r).multiplyScalar(1.25));
  }
  const extra = track(new THREE.BufferGeometry().setFromPoints(pos));
  group.add(new THREE.Points(extra, ptsMat));

  const segs = [];
  const seen = new Set();
  pos.forEach((p, i) => {
    const near = pos.map((q, j) => [j, p.distanceToSquared(q)])
      .filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2);
    near.forEach(([j]) => {
      const k = i < j ? i + '-' + j : j + '-' + i;
      if (seen.has(k)) return;
      seen.add(k);
      segs.push(p, pos[j]);
    });
  });
  const netGeo = track(new THREE.BufferGeometry().setFromPoints(segs));
  const netMat = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 }));
  group.add(new THREE.LineSegments(netGeo, netMat));

  // Sizing
  const resize = () => {
    const w = box.clientWidth || 1;
    const h = box.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // Pointer parallax
  const target = { x: 0, y: 0 };
  const onMove = (e) => {
    const r = box.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    target.y = Math.max(-1, Math.min(1, nx)) * 0.25;
    target.x = Math.max(-1, Math.min(1, ny)) * 0.25;
  };
  const onLeave = () => { target.x = 0; target.y = 0; };
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerleave', onLeave);

  // Loop with pause logic
  let raf = 0;
  let last = 0;
  let spin = 0;
  let inView = true;
  let first = true;
  let disposed = false;
  const par = { x: 0, y: 0 };

  const frame = (now) => {
    raf = 0;
    if (disposed) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!reducedMotion) spin += 0.15 * dt;
    par.x += (target.x - par.x) * 0.05;
    par.y += (target.y - par.y) * 0.05;
    group.rotation.y = spin + par.y;
    group.rotation.x = 0.3 + par.x;
    renderer.render(scene, camera);
    if (first) {
      first = false;
      canvas.classList.add('is-ready');
      box.classList.add('scene-on');
    }
    schedule();
  };
  const schedule = () => {
    if (!raf && !disposed && inView && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; };

  const onVis = () => (document.hidden ? stop() : schedule());
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    if (inView) schedule(); else stop();
  });
  io.observe(box);
  schedule();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    io.disconnect();
    ro.disconnect();
    box.removeEventListener('pointermove', onMove);
    box.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return { dispose };
}
