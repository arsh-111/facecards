import { useEffect, useRef } from 'react';
import { useApp } from '../store';
import { act } from './sync';

/** FR-28: instantly swap to a neutral decoy and pause the game. */
export function triggerPanic(): void {
  const { room, setDecoy } = useApp.getState();
  setDecoy(true);
  document.title = 'Calculator';
  if (room && room.state === 'playing') void act('game:pause');
}

export function exitPanic(): void {
  useApp.getState().setDecoy(false);
  document.title = 'Nights';
}

/** Returns a click handler that fires `fn` on a double tap (touch or mouse). */
export function useDoubleTap(fn: () => void, ms = 350) {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current < ms) {
      last.current = 0;
      fn();
    } else last.current = now;
  };
}

/** Shake gesture via DeviceMotion where available (no permission prompt is triggered here). */
export function useShake(fn: () => void, threshold = 28) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;
    let lastFire = 0;
    const h = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      const now = Date.now();
      if (mag > threshold && now - lastFire > 1500) {
        lastFire = now;
        fn();
      }
    };
    window.addEventListener('devicemotion', h);
    return () => window.removeEventListener('devicemotion', h);
  }, [fn, threshold]);
}
