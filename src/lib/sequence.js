// Scroll-driven film: rendered frames (Blender, Cycles) drawn on a 2D canvas.
//
// Two sequences: the main film ('f', with beats) and the crate loop ('l', 48 frames that start and end
// in the same pose). The page's markers set the timeline:
//   [data-beat] ×5   intro · needle · teardown · numbers · crate  → main film, beat to beat
//   [data-loop-end]  the loop plays once per project between the crate beat and this marker
//   [data-contact]   main film again, from the crate beat to the last beat
// Frames load coarse-to-fine, so the film is usable after ~20 images.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = (n) => String(n).padStart(4, '0');

export function pickVariant() {
  const portrait = window.innerWidth / window.innerHeight < 0.9;
  const dpr = window.devicePixelRatio || 1;
  if (portrait) return { name: 'tall', size: window.innerWidth * dpr > 600 ? 'l' : 's' };
  return { name: 'wide', size: window.innerWidth * dpr > 1300 ? 'l' : 's' };
}

export class Sequence {
  constructor(canvas, { manifest, variant, lenis, reduce, count = 1, onFrame, onReady }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    const name = manifest[variant.name] ? variant.name : 'wide';
    this.m = manifest[name];
    this.base = `/frames/${name}-${variant.size}/`;
    this.lenis = lenis;
    this.reduce = reduce;
    this.count = count;
    this.cb = { onFrame, onReady };
    this.images = { f: new Array(this.m.frames), l: new Array(this.m.loop || 0) };
    this.keys = { beats: [], loopEnd: 0, contact: 0 };
    this.last = '';
    this.ready = false;
    this.alive = true;
    this.frames = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.load();
    const loop = (t) => {
      if (!this.alive) return;
      this.lenis?.raf(t);
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setCount(n) {
    this.count = Math.max(1, n);
    this.last = '';
  }

  // Coarse-to-fine: every 8th frame of both sequences, then every 4th, 2nd, then the rest.
  load() {
    const order = [];
    const seen = new Set();
    for (const step of [8, 4, 2, 1]) {
      for (const seq of ['f', 'l']) {
        const n = this.images[seq].length;
        for (let i = 0; i < n; i += step) {
          const k = `${seq}${i}`;
          if (!seen.has(k)) seen.add(k), order.push([seq, i]);
        }
      }
    }
    let next = 0;
    const pump = () => {
      if (!this.alive || next >= order.length) return;
      const [seq, i] = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.images[seq][i] = img;
        this.last = ''; // redraw with the better frame
        if (!this.ready && this.images.f[0]) {
          this.ready = true;
          this.cb.onReady?.();
        }
        pump();
      };
      img.onerror = pump;
      img.src = `${this.base}${seq}_${pad(i + 1)}.webp`;
    };
    for (let k = 0; k < 6; k++) pump();
  }

  measure() {
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    this.keys.beats = [...document.querySelectorAll('[data-beat]')].map(top);
    const end = document.querySelector('[data-loop-end]');
    const contact = document.querySelector('[data-contact]');
    this.keys.loopEnd = end ? top(end) : 0;
    this.keys.contact = contact ? top(contact) : 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    const W = this.m.width;
    const H = this.m.height;
    const s = Math.max(this.canvas.width / W, this.canvas.height / H);
    const dw = W * s;
    const dh = H * s;
    const ax = this.m.anchorX ?? 0.5;
    this.fit = { dx: (this.canvas.width - dw) * ax, dy: (this.canvas.height - dh) * 0.5, dw, dh, dpr };
    this.measure();
    this.last = '';
  }

  // Where we are for the current scroll position: { seq, f (fractional, 0-based), index, phase }.
  locate(y) {
    const { beats, loopEnd, contact } = this.keys;
    const B = this.m.beats.map((b) => b - 1);
    if (B.length < 6) B[5] = B[4]; // film without the crate loop (older render)
    const main = (f) => ({ seq: 'f', f: clamp(f, 0, this.m.frames - 1), index: -1, phase: 0 });
    if (beats.length < 5) return main(0);
    if (y <= beats[0]) return main(B[0]);
    for (let i = 0; i < 4; i++) {
      if (y < beats[i + 1]) {
        const t = clamp((y - beats[i]) / Math.max(1, beats[i + 1] - beats[i]), 0, 1);
        return main(this.reduce ? B[t < 0.5 ? i : i + 1] : B[i] + t * (B[i + 1] - B[i]));
      }
    }
    if (this.m.loop && loopEnd > beats[4] && y < loopEnd) {
      const u = ((y - beats[4]) / (loopEnd - beats[4])) * this.count;
      const index = Math.min(this.count - 1, Math.floor(u));
      const phase = this.reduce ? 0.55 : clamp(u - index, 0, 1);
      return { seq: 'l', f: phase * (this.m.loop - 1), index, phase };
    }
    if (y < loopEnd) return main(B[4]);
    if (contact > loopEnd && y < contact) {
      const t = clamp((y - loopEnd) / Math.max(1, contact - loopEnd), 0, 1);
      return main(this.reduce ? B[t < 0.5 ? 4 : 5] : B[4] + t * (B[5] - B[4]));
    }
    return main(B[5]);
  }

  nearest(seq, i, dir) {
    const imgs = this.images[seq];
    for (let k = i; k >= 0 && k < imgs.length; k += dir) if (imgs[k]) return k;
    return -1;
  }

  tick() {
    if (this.frames++ % 30 === 0) this.measure();
    const at = this.locate(window.scrollY);
    const key = `${at.seq}${Math.round(at.f * 8) / 8}`;
    if (key === this.last) return;
    this.last = key;
    const imgs = this.images[at.seq];
    const a = this.nearest(at.seq, Math.floor(at.f), -1);
    const b = this.nearest(at.seq, Math.ceil(at.f), 1);
    if (a < 0 && b < 0) return;
    const ia = a >= 0 ? a : b;
    const { ctx } = this;
    const { dx, dy, dw, dh } = this.fit;
    ctx.globalAlpha = 1;
    ctx.drawImage(imgs[ia], dx, dy, dw, dh);
    if (b >= 0 && b !== ia) {
      const t = (at.f - ia) / (b - ia);
      if (t > 0.02) {
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.drawImage(imgs[b], dx, dy, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
    this.cb.onFrame?.({ ...at, project: (name) => this.project(at, name), face: () => this.face(at) });
  }

  toScreen([x, y]) {
    const { dx, dy, dw, dh, dpr } = this.fit;
    return { x: (dx + x * dw) / dpr, y: (dy + y * dh) / dpr };
  }

  // Screen position (CSS px) of an exported anchor.
  project(at, name) {
    const pts = at.seq === 'l' ? this.m.loopPoints[name] : this.m.points[name];
    if (!pts) return null;
    const i = Math.floor(at.f);
    const j = Math.min(pts.length - 1, i + 1);
    const t = at.f - i;
    return this.toScreen([pts[i][0] + (pts[j][0] - pts[i][0]) * t, pts[i][1] + (pts[j][1] - pts[i][1]) * t]);
  }

  // The lifted sleeve's front face: four screen corners and how much it faces the camera.
  face(at) {
    const faces = at.seq === 'l' ? this.m.loopFaces : this.m.faces;
    if (!faces) return null;
    const i = Math.floor(at.f);
    const j = Math.min(faces.length - 1, i + 1);
    const t = at.f - i;
    const A = faces[i];
    const Bf = faces[j];
    return {
      corners: A.c.map((c, k) => this.toScreen([c[0] + (Bf.c[k][0] - c[0]) * t, c[1] + (Bf.c[k][1] - c[1]) * t])),
      v: A.v + (Bf.v - A.v) * t,
    };
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
  }
}

// CSS matrix3d that maps a w×h element (transform-origin 0 0) onto four screen points
// (top-left, top-right, bottom-right, bottom-left). Projective mapping via adjugates.
export function matrix3dFor(w, h, [p0, p1, p2, p3]) {
  const adj = (m) => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
  const mul = (a, b) => {
    const c = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
    return c;
  };
  const mulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const basis = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
    const v = mulV(adj(m), [x4, y4, 1]);
    return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
  };
  const src = basis(0, 0, w, 0, w, h, 0, h);
  const dst = basis(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const H = mul(dst, adj(src)).map((x) => x / 1);
  const n = H[8] || 1;
  const t = H.map((x) => x / n);
  return `matrix3d(${t[0]},${t[3]},0,${t[6]},${t[1]},${t[4]},0,${t[7]},0,0,1,0,${t[2]},${t[5]},0,${t[8]})`;
}

// Point-in-quad test for the sleeve (click / hover on the lifted record).
export function inQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
