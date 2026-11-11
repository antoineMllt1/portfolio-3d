// The mix: one audio element, faded in and out.
let audio = null;

export function toggle(src) {
  if (!src) return false;
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
