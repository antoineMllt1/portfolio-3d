// The mix: one audio element with fades. Without a track yet, a click gives a short scratch.
let audio = null;
let ctx = null;

export function hasTrack(src) {
  return !!src;
}

export function toggle(src) {
  if (!src) {
    scratch();
    return false;
  }
  if (!audio || audio.dataset.src !== src) {
    audio?.pause();
    audio = new Audio(src);
    audio.dataset.src = src;
    audio.loop = true;
    audio.preload = 'auto';
  }
  if (audio.paused) {
    audio.volume = 0;
    audio.play().catch(() => {});
    fade(0.85);
    return true;
  }
  fade(0, () => audio.pause());
  return false;
}

function fade(to, done) {
  const from = audio.volume;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 600);
    audio.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

export function scratch() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(ctx.sampleRate * 0.32);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(0.6, ctx.currentTime);
    src.playbackRate.linearRampToValueAtTime(1.8, ctx.currentTime + 0.16);
    src.playbackRate.linearRampToValueAtTime(0.5, ctx.currentTime + 0.32);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  } catch {
    /* audio unavailable */
  }
}
