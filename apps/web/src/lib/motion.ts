import { useEffect, useState } from 'react';
import { useSettings } from '../store';

/** True when the OS asks for reduced motion OR the in-app Animation Level is Reduced. */
export function useReduced(): boolean {
  const settings = useSettings();
  const [os, setOs] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setOs(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return os || settings.animation === 'reduced';
}
