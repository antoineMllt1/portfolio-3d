// One gesture = one step. Wheel (mouse notches and trackpad swipes with their inertia), touch swipes
// and keys are turned into step(±1) / side(±1) / jump('first' | 'last').
import { useEffect, useRef } from 'react';

export function useFloorInput(handlers) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    // --- wheel: a trackpad swipe sends a long stream of events that fades out. Only its start counts:
    // after a step, nothing fires until the stream has paused, or clearly picks up again (a new swipe).
    let armed = true;
    let lastT = 0;
    let lastAbs = 0;
    let acc = 0;
    const canScroll = (el, dy) => {
      const box = el.closest?.('[data-scroll]');
      if (!box || box.scrollHeight <= box.clientHeight + 1) return false;
      return dy > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 0;
    };
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom
      if (canScroll(e.target, e.deltaY)) return;
      e.preventDefault();
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;
      const d = horizontal ? e.deltaX : e.deltaY;
      const abs = Math.abs(d) * (e.deltaMode === 1 ? 32 : 1);
      const now = performance.now();
      const gap = now - lastT;
      if (gap > 160 || (abs > lastAbs * 2.2 && abs > 40 && gap > 12)) {
        armed = true;
        acc = 0;
      }
      lastT = now;
      lastAbs = abs;
      if (!armed) return;
      acc += abs;
      if (acc < 24) return; // ignore a brush of the pad
      armed = false;
      acc = 0;
      if (horizontal) h.current.side?.(d > 0 ? 1 : -1);
      else h.current.step?.(d > 0 ? 1 : -1);
    };

    // --- touch
    let start = null;
    const onTouchStart = (e) => {
      const t = e.touches[0];
      start = e.target.closest?.('[data-scroll]') && canScroll(e.target, 1) ? null : { x: t.clientX, y: t.clientY, at: performance.now() };
    };
    const onTouchEnd = (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = start.x - t.clientX;
      const dy = start.y - t.clientY;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 44) return;
      if (Math.abs(dy) > Math.abs(dx)) h.current.step?.(dy > 0 ? 1 : -1);
      else h.current.side?.(dx > 0 ? 1 : -1);
    };

    // --- keys
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
      const k = e.key;
      const onControl = e.target.closest?.('button, a');
      if (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !onControl)) h.current.step?.(1);
      else if (k === 'ArrowUp' || k === 'PageUp') h.current.step?.(-1);
      else if (k === 'ArrowRight') h.current.side?.(1);
      else if (k === 'ArrowLeft') h.current.side?.(-1);
      else if (k === 'Home') h.current.jump?.('first');
      else if (k === 'End') h.current.jump?.('last');
      else return;
      e.preventDefault();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
