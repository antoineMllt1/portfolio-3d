// Scroll-driven film: a sequence of rendered frames (Blender, Cycles) drawn on a 2D canvas.
// The page's [data-key] markers are the beats; between two markers the film plays the frames between
// the two matching beat frames. Frames load coarse-to-fine, so the film is usable after ~15 images.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function pickVariant() {
  const portrait = window.innerWidth / window.innerHeight < 0.9;
  const dpr = window.devicePixelRatio || 1;
  if (portrait) return { name: 'tall', size: window.innerWidth * dpr > 600 ? 'l' : 's' };
  return { name: 'wide', size: window.innerWidth * dpr > 1300 ? 'l' : 's' };
}

export class Sequence {
  constructor(canvas, { manifest, variant, lenis, reduce, onFrame, onReady }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    // Phones fall back to the desktop film if the portrait one is missing.
    const name = manifest[variant.name] ? variant.name : 'wide';
    this.m = manifest[name];
    this.base = `/frames/${name}-${variant.size}/`;
    this.lenis = lenis;
    this.reduce = reduce;
    this.cb = { onFrame, onReady };
    this.images = new Array(this.m.frames);
    this.loaded = new Uint8Array(this.m.frames);
    this.keys = [];
    this.last = -1;
    this.ready = false;
    this.alive = true;
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

  // Coarse-to-fine: every 8th frame, then every 4th, 2nd, then the rest; a few at a time.
  load() {
    const n = this.m.frames;
    const order = [];
    const seen = new Set();
    for (const step of [8, 4, 2, 1]) {
      for (let i = 0; i < n; i += step) if (!seen.has(i)) seen.add(i), order.push(i);
    }
    if (!seen.has(n - 1)) order.splice(1, 0, n - 1);
    let next = 0;
    let firstBatch = Math.ceil(n / 8) + 1;
    const pump = () => {
      if (!this.alive || next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.images[i] = img;
        this.loaded[i] = 1;
        this.last = -1; // redraw with the better frame
        firstBatch -= 1;
        if (!this.ready && (firstBatch <= 0 || i === 0)) {
          this.ready = this.loaded[0] === 1;
          if (this.ready) this.cb.onReady?.();
        }
        pump();
      };
      img.onerror = pump;
      img.src = `${this.base}f_${String(i + 1).padStart(4, '0')}.webp`;
    };
    for (let k = 0; k < 6; k++) pump();
  }

  measure() {
    this.keys = [...document.querySelectorAll('[data-key]')].map((el) => el.getBoundingClientRect().top + window.scrollY);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    // Cover fit, anchored right on wide screens (the object sits right of the text).
    const W = this.m.width;
    const H = this.m.height;
    const s = Math.max(this.canvas.width / W, this.canvas.height / H);
    const dw = W * s;
    const dh = H * s;
    const ax = this.m.anchorX ?? 0.5;
    this.fit = { s, dx: (this.canvas.width - dw) * ax, dy: (this.canvas.height - dh) * 0.5, dw, dh, dpr };
    this.measure();
    this.last = -1;
  }

  // Frame (fractional, 0-based) for the current scroll position.
  frameAt(y) {
    const { keys } = this;
    const beats = this.m.beats.map((b) => b - 1);
    if (keys.length < 2) return 0;
    if (y <= keys[0]) return beats[0];
    for (let i = 0; i < Math.min(keys.length, beats.length) - 1; i++) {
      if (y < keys[i + 1]) {
        const t = clamp((y - keys[i]) / Math.max(1, keys[i + 1] - keys[i]), 0, 1);
        return this.reduce ? beats[t < 0.5 ? i : i + 1] : beats[i] + t * (beats[i + 1] - beats[i]);
      }
    }
    return beats[beats.length - 1];
  }

  nearest(i, dir) {
    for (let k = i; k >= 0 && k < this.m.frames; k += dir) if (this.loaded[k]) return k;
    return -1;
  }

  tick() {
    if (this.frames++ % 30 === 0) this.measure();
    const f = clamp(this.frameAt(window.scrollY), 0, this.m.frames - 1);
    const key = Math.round(f * 8) / 8;
    if (key === this.last) return;
    this.last = key;
    const a = this.nearest(Math.floor(f), -1);
    const b = this.nearest(Math.ceil(f), 1);
    const { ctx } = this;
    const { dx, dy, dw, dh } = this.fit;
    if (a < 0 && b < 0) return;
    const ia = a >= 0 ? a : b;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.images[ia], dx, dy, dw, dh);
    // Cross-fade to the next frame for in-between scroll positions.
    if (b >= 0 && b !== ia) {
      const t = (f - ia) / (b - ia);
      if (t > 0.02) {
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.drawImage(this.images[b], dx, dy, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
    this.cb.onFrame?.(f, this.project.bind(this, f));
  }

  frames = 0;

  // Screen position (CSS px) of an exported anchor at frame f.
  project(f, name) {
    const pts = this.m.points[name];
    if (!pts) return null;
    const i = Math.floor(f);
    const j = Math.min(pts.length - 1, i + 1);
    const t = f - i;
    const x = pts[i][0] + (pts[j][0] - pts[i][0]) * t;
    const y = pts[i][1] + (pts[j][1] - pts[i][1]) * t;
    const { dx, dy, dw, dh, dpr } = this.fit;
    return { x: (dx + x * dw) / dpr, y: (dy + y * dh) / dpr };
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
  }
}
