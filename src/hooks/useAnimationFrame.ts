import { useEffect, useRef } from 'react';

export function useAnimationFrame(callback: (time: number) => void, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;
    const loop = (time: number) => {
      callbackRef.current(time);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [enabled]);
}
