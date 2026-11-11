// The rendered film (Blender, Cycles) drawn on a 2D canvas.
//
// Two frame sequences, rendered with motion blur:
//   f  the camera travelling between the floors (one beat frame per floor);
//   c  someone going through the crate: record k is pulled up at frame first + step·k.
// The frames the page rests on ("holds") also exist as bigger, cleaner renders. At rest the hold fades
// in over the film frame and the view drifts very slowly, so the picture never looks like a paused video.
// A sequence without motion frames (see `motion` in the manifest) dissolves from hold to hold instead.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = (n) => String(n).padStart(4, '0');

export function pickVariant(manifest) {
  const portrait = window.innerWidth / window.innerHeight < 0.9;
  const px = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  const name = portrait && manifest.tall ? 'tall' : 'wide';
  return { name, size: px > 1700 ? 'l' : 's' };
}

export class Film {
  constructor(canvas, { manifest, variant, reduce, onReady, onProgress }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.m = manifest[variant.name];
    this.base = `/frames/${variant.name}-${variant.size}/`;
    // Which sequences have motion frames (a variant can be published with the travel frames only).
    const has = this.m.motion || { f: !this.m.stills, c: !this.m.stills };
    this.has = { f: !!has.f && !reduce, c: !!has.c && !reduce };
    this.reduce = reduce;
    this.cb = { onReady, onProgress };
    this.len = { f: this.m.frames, c: this.m.crate.frames };
    this.images = { f: [], c: [] };
    this.hd = {};
    this.wanted = new Set();
    this.beats = this.m.beats.map((b) => b - 1);
    this.pos = { seq: 'f', f: this.beats[0] };
    this.anim = null;
    this.fade = null;
    this.view = { s: 1, x: 0, y: 0 };
    this.rest = 0;
    this.hdAlpha = 0;
    this.last = '';
    this.drawn = 0;
    this.loaded = 0;
    this.total = 1;
    this.ready = false;
    this.alive = true;
    this.now = performance.now();
    this.snap = document.createElement('canvas');
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

  holdOf(k) {
    return this.m.crate.first + this.m.crate.step * k;
  }

  // ---- loading: first hold, then the travel frames coarse-to-fine, then the crate, then the holds.
  load() {
    const queue = [];
    const hold = (seq, i) => queue.push([seq, i, true]);
    const motion = (seq, steps) => {
      if (!this.has[seq]) return;
      for (const step of steps) for (let i = 0; i < this.len[seq]; i += step) queue.push([seq, i, false]);
    };
    hold('f', this.beats[0]);
    motion('f', [6, 3]);
    this.beats.slice(1).forEach((b) => hold('f', b));
    motion('f', [1]);
    hold('c', this.holdOf(0));
    motion('c', [5, 1]);
    for (let k = 1; k < this.m.crate.order.length; k++) hold('c', this.holdOf(k));
    // The coarse passes queue some frames twice: keep the first.
    const seen = new Set();
    this.queue = queue.filter(([s, i, h]) => {
      const key = `${h ? 'h' : ''}${s}${i}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.total = this.queue.length;
    for (let k = 0; k < 6; k++) this.pump();
  }

  pump() {
    if (!this.alive) return;
    // A hold the page is waiting on jumps the queue.
    let idx = this.queue.findIndex(([s, i, h]) => h && this.wanted.has(`${s}${i}`));
    if (idx < 0) idx = 0;
    const job = this.queue.splice(idx, 1)[0];
    if (!job) return;
    const [seq, i, hold] = job;
    const img = new Image();
    img.decoding = 'async';
    const done = () => {
      this.loaded += 1;
      this.cb.onProgress?.(this.loaded / this.total);
      this.pump();
    };
    img.onload = () => {
      if (hold) this.hd[`${seq}${i}`] = img;
      else this.images[seq][i] = img;
      this.last = '';
      if (!this.ready && (this.hd[`f${this.beats[0]}`] || this.images.f[this.beats[0]])) {
        this.ready = true;
        this.cb.onReady?.();
      }
      done();
    };
    img.onerror = done;
    img.src = `${this.base}${hold ? 'h_' : ''}${seq}_${pad(i + 1)}.webp`;
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

  // ---- moves
  play(seq, to, seconds, done) {
    if (!this.has[seq] || !this.covered(seq, this.pos.f, to)) return this.dissolve(seq, to, done);
    this.pos.seq = seq;
    this.anim = { from: this.pos.f, to, t0: this.now, dur: Math.max(0.001, seconds) * 1000, done };
  }

  // Enough of the frames between a and b have arrived to play the move (one in three, the coarse pass).
  covered(seq, a, b) {
    const lo = Math.round(Math.min(a, b));
    const hi = Math.round(Math.max(a, b));
    let n = 0;
    for (let i = lo; i <= hi; i++) if (this.images[seq][i]) n += 1;
    return n * 3 >= hi - lo;
  }

  dissolve(seq, to, done, ms = 520) {
    this.snap.width = this.canvas.width;
    this.snap.height = this.canvas.height;
    this.snap.getContext('2d').drawImage(this.canvas, 0, 0);
    this.pos = { seq, f: to };
    this.anim = null;
    this.rest = 0;
    this.fade = { t0: this.now, dur: this.reduce ? 1 : ms, done };
    this.want(seq, to);
    this.last = '';
  }

  want(seq, i) {
    if (!this.hd[`${seq}${i}`]) this.wanted.add(`${seq}${i}`);
  }

  // Floors: one beat away the camera travels; further away (or without motion frames) it dissolves.
  toBeat(index, fromIndex, done) {
    const to = this.beats[index];
    this.want('f', to);
    if (this.pos.seq !== 'f' || Math.abs(index - fromIndex) !== 1) return this.dissolve('f', to, done);
    this.play('f', to, 1.15, done);
  }

  // Crate: from the crate beat (frame 0 of `c`) to record k, or between two records.
  toRecord(k, done) {
    const to = this.holdOf(k);
    this.want('c', to);
    if (this.pos.seq !== 'c') this.pos = { seq: 'c', f: 0 };
    const steps = Math.abs(to - this.pos.f) / this.m.crate.step;
    this.play('c', to, clamp(0.38 + 0.11 * steps, 0.45, 1.5), done);
  }

  closeCrate(done, beatIndex) {
    if (this.pos.seq !== 'c') return done?.();
    const steps = this.pos.f / this.m.crate.step;
    const back = () => {
      this.pos = { seq: 'f', f: this.beats[beatIndex] };
      done?.();
    };
    if (!this.has.c || !this.covered('c', this.pos.f, 0)) return back();
    this.play('c', 0, clamp(0.25 + 0.07 * steps, 0.3, 1.0), back);
  }

  // ---- drawing
  nearest(seq, i) {
    const imgs = this.images[seq];
    for (let d = 0; d < this.len[seq]; d++) {
      if (imgs[i - d]) return i - d;
      if (imgs[i + d]) return i + d;
    }
    return -1;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.now) / 1000);
    this.now = now;
    const a = this.anim;
    if (a) {
      const t = clamp((now - a.t0) / a.dur, 0, 1);
      this.pos.f = a.from + (a.to - a.from) * t;
      if (t >= 1) {
        this.anim = null;
        this.pos.f = a.to;
        a.done?.();
      }
    }
    const moving = !!this.anim;
    this.rest = moving ? 0 : this.rest + dt;
    const { seq } = this.pos;
    const i = Math.round(this.pos.f);
    const key = `${seq}${i}`;
    const hd = moving ? null : this.hd[key];
    const j = this.nearest(seq, i);
    const base = j >= 0 ? this.images[seq][j] : null;
    // The clean hold fades in over the film frame once at rest.
    this.hdAlpha = hd ? clamp(this.hdAlpha + dt / 0.35, 0, 1) : 0;
    // Slow drift at rest (zoom in a little, tiny pan); eased back when moving.
    const v = this.view;
    const tgt = !moving && !this.reduce ? { s: 1 + (0.03 * (1 - Math.cos((this.rest * 2 * Math.PI) / 36))) / 2, x: 6 * Math.sin((this.rest * 2 * Math.PI) / 47), y: 3 * Math.sin((this.rest * 2 * Math.PI) / 39) } : { s: 1, x: 0, y: 0 };
    const k = 1 - Math.exp(-dt * (moving ? 5 : 1.2));
    v.s += (tgt.s - v.s) * k;
    v.x += (tgt.x - v.x) * k;
    v.y += (tgt.y - v.y) * k;

    const fading = this.fade ? clamp((now - this.fade.t0) / this.fade.dur, 0, 1) : 1;
    const drifting = Math.abs(v.s - 1) > 0.0004 || Math.abs(v.x) > 0.2;
    const state = `${key}|${j}|${hd ? 1 : 0}`;
    const busy = moving || this.fade || (hd && this.hdAlpha < 1);
    if (state === this.last && !busy && (!drifting || now - this.drawn < 40)) return;
    if (!base && !hd) return;
    this.last = state;
    this.drawn = now;
    const { ctx } = this;
    const { dx, dy, dw, dh, dpr } = this.fit;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    ctx.setTransform(v.s, 0, 0, v.s, cx * (1 - v.s) + v.x * dpr, cy * (1 - v.s) + v.y * dpr);
    ctx.globalAlpha = 1;
    if (base && !(hd && this.hdAlpha >= 1)) ctx.drawImage(base, dx, dy, dw, dh);
    if (hd) {
      ctx.globalAlpha = base ? this.hdAlpha : 1;
      ctx.drawImage(hd, dx, dy, dw, dh);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.fade) {
      if (fading < 1) {
        ctx.globalAlpha = 1 - fading * fading * (3 - 2 * fading);
        ctx.drawImage(this.snap, 0, 0);
      } else {
        const done = this.fade.done;
        this.fade = null;
        done?.();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Screen position (CSS px) of a point given in frame coordinates (0–1).
  toScreen([x, y]) {
    const { dx, dy, dw, dh, dpr } = this.fit;
    const { s, x: px, y: py } = this.view;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return { x: (s * (dx + x * dw) + cx * (1 - s) + px * dpr) / dpr, y: (s * (dy + y * dh) + cy * (1 - s) + py * dpr) / dpr };
  }

  // The front cover of record k when it is pulled up: four screen corners, or null while moving.
  coverQuad(k) {
    if (this.anim || this.fade || this.pos.seq !== 'c' || Math.round(this.pos.f) !== this.holdOf(k)) return null;
    return this.m.crate.quads[k].map((p) => this.toScreen(p));
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
  }
}

export function inQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
