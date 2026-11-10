// The rendered film (Blender, Cycles) drawn on a 2D canvas, played by time between "floors".
//
// Two sequences: the main film ('f', with one beat frame per floor) and the crate loop ('l', 48 frames
// that start and end in the same pose, played when the projects floor is shown).
//   travel(frame, done)  plays the main film from where it is to `frame`
//   lift(done)           pulls the front record out of the crate (loop frames 0 → HOLD)
//   putBack(done)        returns it (HOLD → last frame), then the main film resumes at the crate beat
// Frames load coarse-to-fine, so the film is usable after ~20 images. The frames the page rests on
// ("holds") also exist as bigger renders, drawn whenever they are the current frame; and at rest the
// view drifts very slowly (a slight zoom and pan), so the picture never looks frozen.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = (n) => String(n).padStart(4, '0');
const LOOP_FPS = 40;

export function pickVariant() {
  const portrait = window.innerWidth / window.innerHeight < 0.9;
  const dpr = window.devicePixelRatio || 1;
  if (portrait) return { name: 'tall', size: window.innerWidth * dpr > 600 ? 'l' : 's' };
  return { name: 'wide', size: window.innerWidth * dpr > 1300 ? 'l' : 's' };
}

export class Film {
  static HOLD = 27;
  static IDLE = [24, 30];

  constructor(canvas, { manifest, variant, reduce, onFrame, onReady, onProgress }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    const name = manifest[variant.name] ? variant.name : 'wide';
    this.m = manifest[name];
    this.base = `/frames/${name}-${variant.size}/`;
    this.reduce = reduce;
    this.cb = { onFrame, onReady, onProgress };
    this.loaded = 0;
    this.images = { f: new Array(this.m.frames), l: new Array(this.m.loop || 0) };
    this.hd = {};
    this.view = { s: 1, x: 0, y: 0 };
    this.rest = 0; // seconds at rest
    this.drawn = 0;
    this.beats = this.m.beats.map((b) => b - 1);
    // Players: the main film and the loop, each with a current frame, a target and a callback.
    this.main = { f: this.beats[0], to: this.beats[0], done: null, fps: 32 };
    this.loop = { f: 0, to: 0, done: null, idle: 0, fps: LOOP_FPS };
    this.mode = 'f';
    this.last = '';
    this.ready = false;
    this.alive = true;
    this.now = performance.now();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.load();
    const tick = () => {
      if (!this.alive) return;
      this.tick();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // Coarse-to-fine: every 8th frame of both sequences, then every 4th, 2nd, then the rest.
  load() {
    const order = [];
    const seen = new Set();
    for (const step of [8, 4, 2, 1]) {
      for (const seq of ['f', 'l']) {
        for (let i = 0; i < this.images[seq].length; i += step) {
          const k = `${seq}${i}`;
          if (!seen.has(k)) seen.add(k), order.push([seq, i, false]);
        }
      }
      if (step === 8) for (const [seq, i] of this.m.holds || []) order.push([seq, i, true]);
    }
    let next = 0;
    const pump = () => {
      if (!this.alive || next >= order.length) return;
      const [seq, i, hold] = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (hold) this.hd[`${seq}${i}`] = img;
        else this.images[seq][i] = img;
        this.last = '';
        this.loaded += 1;
        this.cb.onProgress?.(this.loaded / order.length);
        if (!this.ready && this.images.f[0]) {
          this.ready = true;
          this.cb.onReady?.();
        }
        pump();
      };
      img.onerror = pump;
      img.src = `${this.base}${hold ? 'h_' : ''}${seq}_${pad(i + 1)}.webp`;
    };
    for (let k = 0; k < 6; k++) pump();
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
    this.last = '';
  }

  // Plays the main film to `frame`: about a second for one beat, never more than 1.6 s.
  travel(frame, done) {
    this.mode = 'f';
    this.main.to = clamp(frame, 0, this.m.frames - 1);
    const dist = Math.abs(this.main.to - this.main.f);
    this.main.fps = dist / clamp(dist / 32, 0.8, 1.6);
    this.main.done = done || null;
    if (this.reduce) this.main.f = this.main.to;
  }

  lift(done) {
    this.mode = 'l';
    this.loop.to = Film.HOLD;
    this.loop.done = done || null;
    if (this.reduce) this.loop.f = Film.HOLD;
  }

  putBack(done) {
    const end = this.m.loop - 1;
    this.loop.to = end;
    this.loop.done = () => {
      this.loop.f = 0;
      this.loop.to = 0;
      this.mode = 'f';
      done?.();
    };
    if (this.reduce) this.loop.f = end;
  }

  step(pl, dt) {
    if (pl.f < pl.to) pl.f = Math.min(pl.to, pl.f + dt * pl.fps);
    else if (pl.f > pl.to) pl.f = Math.max(pl.to, pl.f - dt * pl.fps);
    if (pl.f === pl.to && pl.done) {
      const cb = pl.done;
      pl.done = null;
      cb();
    }
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.now) / 1000);
    this.now = now;
    this.step(this.main, dt);
    let seq = 'f';
    let f = this.main.f;
    if (this.mode === 'l' && this.m.loop) {
      this.step(this.loop, dt);
      seq = 'l';
      f = this.loop.f;
      // Held out: a slow drift so the record never looks frozen.
      if (f === Film.HOLD && this.loop.to === Film.HOLD && !this.loop.done && !this.reduce) {
        this.loop.idle += dt;
        const [a, b] = Film.IDLE;
        f = a + ((b - a) * (1 - Math.cos(this.loop.idle * 0.9))) / 2;
      }
    }
    // At rest the view drifts (slow zoom, slight pan); on the move it eases back to the plain frame.
    const atRest = this.main.f === this.main.to && (this.mode === 'f' || this.loop.to === Film.HOLD);
    this.rest = atRest ? this.rest + dt : 0;
    const v = this.view;
    const tgt = atRest && !this.reduce ? { s: 1 + 0.045 * (1 - Math.cos((this.rest * 2 * Math.PI) / 30)) / 2, x: 10 * Math.sin((this.rest * 2 * Math.PI) / 41), y: 6 * Math.sin((this.rest * 2 * Math.PI) / 33 + 1) } : { s: 1, x: 0, y: 0 };
    const k = 1 - Math.exp(-dt * (atRest ? 1.5 : 4));
    v.s += (tgt.s - v.s) * k;
    v.x += (tgt.x - v.x) * k;
    v.y += (tgt.y - v.y) * k;
    const i0 = Math.round(f);
    let i = this.nearest(seq, i0, -1);
    if (i < 0) i = this.nearest(seq, i0, 1);
    if (i < 0) return;
    const img = this.hd[`${seq}${i}`] || this.images[seq][i];
    const key = `${seq}${i}${img === this.images[seq][i] ? '' : 'h'}`;
    const moved = Math.abs(v.s - 1) > 0.0005 || Math.abs(v.x) > 0.3 || Math.abs(v.y) > 0.3;
    if (key === this.last && (!moved || now - this.drawn < 33)) return;
    this.last = key;
    this.drawn = now;
    const { dx, dy, dw, dh, dpr } = this.fit;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    this.ctx.setTransform(v.s, 0, 0, v.s, cx * (1 - v.s) + v.x * dpr, cy * (1 - v.s) + v.y * dpr);
    this.ctx.drawImage(img, dx, dy, dw, dh);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const at = { seq, f: i };
    this.cb.onFrame?.({ ...at, project: (name) => this.project(at, name), face: () => this.face(at) });
  }

  nearest(seq, i, dir) {
    const imgs = this.images[seq];
    for (let k = i; k >= 0 && k < imgs.length; k += dir) if (imgs[k]) return k;
    return -1;
  }

  toScreen([x, y]) {
    const { dx, dy, dw, dh, dpr } = this.fit;
    const { s, x: px, y: py } = this.view;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return { x: (s * (dx + x * dw) + cx * (1 - s) + px * dpr) / dpr, y: (s * (dy + y * dh) + cy * (1 - s) + py * dpr) / dpr };
  }

  // Screen position (CSS px) of an exported anchor.
  project(at, name) {
    const pts = at.seq === 'l' ? this.m.loopPoints?.[name] : this.m.points[name];
    return pts ? this.toScreen(pts[at.f]) : null;
  }

  // The lifted sleeve's front face: four screen corners and how much it faces the camera.
  face(at) {
    const faces = at.seq === 'l' ? this.m.loopFaces : this.m.faces;
    if (!faces) return null;
    const F = faces[at.f];
    return { corners: F.c.map((c) => this.toScreen(c)), v: F.v };
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
  const H = mul(dst, adj(src));
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
