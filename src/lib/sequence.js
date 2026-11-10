// Scroll-driven film: rendered frames (Blender, Cycles) drawn on a 2D canvas.
//
// Two sequences: the main film ('f', with beats) and the crate loop ('l', 48 frames that start and end
// in the same pose). The page's markers set the timeline:
//   [data-beat] ×5   intro · needle · teardown · numbers · crate  → main film, beat to beat
//   [data-loop-end]  between the crate beat and this marker the crate loop is shown; it is played by
//                    time, not by the scroll: lift() pulls the record out, putBack() returns it
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
  constructor(canvas, { manifest, variant, lenis, reduce, onFrame, onReady, onEnter, onLeave }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    const name = manifest[variant.name] ? variant.name : 'wide';
    this.m = manifest[name];
    this.base = `/frames/${name}-${variant.size}/`;
    this.lenis = lenis;
    this.reduce = reduce;
    this.cb = { onFrame, onReady, onEnter, onLeave };
    this.images = { f: new Array(this.m.frames), l: new Array(this.m.loop || 0) };
    this.keys = { beats: [], loopEnd: 0, contact: 0 };
    // Time-driven crate loop: frame, target frame, callback when the target is reached.
    this.player = { f: 0, to: 0, done: null, idle: 0, inside: false };
    this.now = performance.now();
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
      return { seq: 'l', f: this.player.f, index: -1, phase: 0 };
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

  // The record held out of the crate (the loop's hold pose), and the frames it drifts between.
  static HOLD = 27;
  static IDLE = [24, 30];

  // Pull the front record out of the crate (frames 0 → HOLD).
  lift(done) {
    this.player.to = Sequence.HOLD;
    this.player.done = done || null;
    if (this.reduce) this.player.f = Sequence.HOLD;
  }

  // Put it back (HOLD → last frame), then reset to the first frame and call `done`.
  putBack(done) {
    const end = this.m.loop - 1;
    this.player.to = end;
    this.player.done = () => {
      this.player.f = 0;
      this.player.to = 0;
      done?.();
    };
    if (this.reduce) this.player.f = end;
  }

  advance(dt) {
    const pl = this.player;
    const speed = 34; // frames per second
    if (pl.f < pl.to) pl.f = Math.min(pl.to, pl.f + dt * speed);
    else if (pl.f > pl.to) pl.f = Math.max(pl.to, pl.f - dt * speed);
    if (pl.f === pl.to && pl.done) {
      const cb = pl.done;
      pl.done = null;
      cb();
    }
    // Held out: a slow drift so the record never looks frozen.
    if (pl.f === Sequence.HOLD && pl.to === Sequence.HOLD && !pl.done && !this.reduce) {
      pl.idle += dt;
      const [a, b] = Sequence.IDLE;
      return a + ((b - a) * (1 - Math.cos(pl.idle * 0.9))) / 2;
    }
    return pl.f;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.now) / 1000);
    this.now = now;
    if (this.frames++ % 30 === 0) this.measure();
    const at = this.locate(window.scrollY);
    if (at.seq === 'l') {
      at.f = this.advance(dt);
      if (!this.player.inside) {
        this.player.inside = true;
        this.cb.onEnter?.();
      }
    } else if (this.player.inside) {
      this.player.inside = false;
      this.player.f = 0;
      this.player.to = 0;
      this.player.done = null;
      this.cb.onLeave?.();
    }
    // Nearest rendered frame, no cross-fade: a fade between two camera positions reads as blur.
    const key = `${at.seq}${Math.round(at.f)}`;
    if (key === this.last) return;
    this.last = key;
    let i = this.nearest(at.seq, Math.round(at.f), -1);
    if (i < 0) i = this.nearest(at.seq, Math.round(at.f), 1);
    if (i < 0) return;
    const { dx, dy, dw, dh } = this.fit;
    this.ctx.drawImage(this.images[at.seq][i], dx, dy, dw, dh);
    const shown = { ...at, f: i };
    this.cb.onFrame?.({ ...shown, project: (name) => this.project(shown, name), face: () => this.face(shown) });
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
