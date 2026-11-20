import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { t } from '../i18n';
import { useReduced } from '../lib/motion';
import { exitPanic, triggerPanic, useDoubleTap } from '../lib/panic';
import { useApp } from '../store';

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL ?? 'vers.nude.22@gmail.com';

/** Slow embers; capped count, disabled for reduced motion (Section 8.2). */
export function Background() {
  const reduced = useReduced();
  const embers = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${(i * 73) % 100}%`,
        delay: `${(i * 1.7) % 12}s`,
        duration: `${14 + ((i * 5) % 10)}s`,
        dx: `${((i % 5) - 2) * 18}px`,
      })),
    [],
  );
  return (
    <div aria-hidden className="candle grain pointer-events-none fixed inset-0 -z-0 overflow-hidden">
      {!reduced &&
        embers.map((e, i) => (
          <span
            key={i}
            className="ember"
            style={
              {
                left: e.left,
                animationDelay: e.delay,
                animationDuration: e.duration,
                '--dx': e.dx,
              } as React.CSSProperties
            }
          />
        ))}
    </div>
  );
}

/** Logo; a double tap triggers the panic decoy (FR-28). */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const onTap = useDoubleTap(triggerPanic);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={t('app.name')}
      className={`relative select-none font-display tracking-wide text-rose ${size === 'lg' ? 'text-5xl' : 'text-xl'}`}
    >
      {size === 'lg' && (
        <span aria-hidden className="breathe absolute -inset-10 -z-10 rounded-full bg-crimson/40 blur-3xl" />
      )}
      <span aria-hidden>☾ </span>Night Cards
    </button>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 mt-10 flex flex-wrap justify-center gap-x-5 gap-y-2 pb-6 text-xs text-mist">
      <Link to="/privacy" className="hover:text-blush">{t('footer.privacy')}</Link>
      <Link to="/terms" className="hover:text-blush">{t('footer.terms')}</Link>
      <a href={`mailto:${CONTACT}`} className="hover:text-blush">{t('footer.contact')}: {CONTACT}</a>
    </footer>
  );
}

export function Shell({ children, header, footer = true }: { children: ReactNode; header?: ReactNode; footer?: boolean }) {
  return (
    <div className="relative min-h-dvh">
      <Background />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-3xl">
        {header}
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        {footer && <Footer />}
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  const showToast = useApp((s) => s.showToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => showToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast, showToast]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass rounded-2xl px-4 py-3 text-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** FR-28 neutral calculator decoy. Hold the display ~1s to return. */
export function Decoy() {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<{ v: number; op: string } | null>(null);
  const [fresh, setFresh] = useState(true);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  const input = (k: string) => {
    if (/\d/.test(k) || k === '.') {
      setDisplay((d) => (fresh || d === '0' ? (k === '.' ? '0.' : k) : d.length < 12 ? d + k : d));
      setFresh(false);
    } else if (k === 'C') {
      setDisplay('0');
      setAcc(null);
      setFresh(true);
    } else if (k === '=') {
      if (acc) setDisplay(String(calc(acc.v, Number(display), acc.op)));
      setAcc(null);
      setFresh(true);
    } else {
      setAcc({ v: acc ? calc(acc.v, Number(display), acc.op) : Number(display), op: k });
      setFresh(true);
    }
  };
  const calc = (a: number, b: number, op: string) => {
    const r = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : b === 0 ? 0 : a / b;
    return Math.round(r * 1e8) / 1e8;
  };
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '0', '.', '+'];
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#f2f2f2] p-4 font-sans text-[#222]">
      <div
        role="status"
        aria-label={t('decoy.exitHint')}
        onPointerDown={() => (pressTimer = setTimeout(exitPanic, 900))}
        onPointerUp={() => clearTimeout(pressTimer)}
        onPointerLeave={() => clearTimeout(pressTimer)}
        onKeyDown={(e) => e.key === 'Escape' && exitPanic()}
        tabIndex={0}
        className="mb-4 mt-auto select-none overflow-hidden rounded-xl bg-white p-6 text-right text-5xl font-light shadow-inner"
      >
        {display}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => input(k)}
            className={`h-16 rounded-xl text-2xl ${/\d|\./.test(k) ? 'bg-white' : 'bg-[#dcdcdc]'}`}
          >
            {k}
          </button>
        ))}
        <button type="button" onClick={() => input('=')} className="col-span-4 h-16 rounded-xl bg-[#4a7bd0] text-2xl text-white">
          =
        </button>
      </div>
    </div>
  );
}
