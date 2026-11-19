import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { ActiveCardSnapshot, PlayerSnapshot, TimerSnapshot } from '@nc/shared';
import { t } from '../i18n';
import { useReduced } from '../lib/motion';
import { haptics, sound } from '../lib/feedback';
import { useApp } from '../store';

/* ------------------------------------------------------------------ deck */

/** Stack of card backs. When `shuffling`, it splits into two stacks and riffles (~1.2 s). */
export function Deck({ shuffling, count }: { shuffling: boolean; count: number }) {
  const reduced = useReduced();
  const layers = Math.min(6, Math.max(1, count));
  return (
    <div className="relative mx-auto h-56 w-40" aria-hidden>
      {Array.from({ length: layers }, (_, i) => {
        const left = i % 2 === 0;
        return (
          <motion.div
            key={i}
            className="card-back-pattern absolute inset-0 rounded-2xl border border-rose/30 shadow-xl"
            style={{ zIndex: i }}
            initial={false}
            animate={
              shuffling && !reduced
                ? {
                    x: [0, left ? -70 : 70, left ? -70 : 70, 0],
                    rotate: [0, left ? -8 : 8, left ? -4 : 4, 0],
                    y: [-i * 2, -i * 2 - 6, -i * 2 - (i % 3) * 4, -i * 2],
                  }
                : shuffling && reduced
                  ? { opacity: [1, 0.5, 1], y: -i * 2 }
                  : { x: 0, rotate: 0, y: -i * 2 }
            }
            transition={{ duration: 1.2, ease: 'easeInOut', times: [0, 0.35, 0.7, 1], delay: i * 0.02 }}
          />
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- timer */

export function remainingMs(timer: TimerSnapshot, offset: number): number {
  if (timer.status !== 'running' || timer.startedAt === null) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (Date.now() + offset - timer.startedAt));
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Circular gradient ring; final 10 seconds pulse faster; announced via aria-live (8.6). */
export function TimerRing({ timer, dealSeq }: { timer: TimerSnapshot; dealSeq: number }) {
  const offset = useApp((s) => s.clockOffset);
  const reduced = useReduced();
  const [left, setLeft] = useState(() => remainingMs(timer, offset));
  const [announce, setAnnounce] = useState('');
  const chimed = useRef<number | null>(null);

  useEffect(() => {
    setLeft(remainingMs(timer, offset));
    if (timer.status !== 'running') return;
    const id = setInterval(() => setLeft(remainingMs(timer, offset)), 200);
    return () => clearInterval(id);
  }, [timer, offset]);

  const secs = Math.ceil(left / 1000);
  useEffect(() => {
    if (timer.status !== 'running') return;
    if (left <= 0) {
      if (chimed.current !== dealSeq) {
        chimed.current = dealSeq;
        sound.chime();
        haptics.buzz([60, 80, 60]);
        setAnnounce(t('table.timeUp'));
      }
    } else if (secs % 30 === 0 || secs === 10) {
      setAnnounce(t('table.timeLeft', { time: fmt(left) }));
    }
  }, [secs, left, timer.status, dealSeq]);

  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = timer.durationMs ? 1 - left / timer.durationMs : 0;
  const urgent = timer.status === 'running' && left > 0 && left <= 10_000;

  return (
    <div className="flex flex-col items-center">
      <motion.svg
        viewBox="0 0 100 100"
        className="h-28 w-28"
        animate={urgent && !reduced ? { scale: [1, 1.07, 1] } : { scale: 1 }}
        transition={urgent ? { duration: 0.6, repeat: Infinity } : { duration: 0.2 }}
        aria-hidden
      >
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E8B4A0" />
            <stop offset="100%" stopColor="#B3123F" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(232,180,160,0.15)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
        <text x="50" y="56" textAnchor="middle" fill="#F6DCD2" fontSize="18" fontFamily="Inter">
          {left <= 0 && timer.status === 'running' ? '0:00' : fmt(left)}
        </text>
      </motion.svg>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <span className="text-xs text-mist">
        {left <= 0 && timer.status === 'running'
          ? t('table.timeUp')
          : t('table.timeLeft', { time: fmt(left) })}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ card */

export function GenreBadge({ genre }: { genre: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-rose/40 bg-ink/50 px-3 py-1 text-xs uppercase tracking-widest text-rose">
      {t(`genre.${genre}`)}
    </span>
  );
}

/**
 * The active card. Back shows role assignment (confirm/swap before reveal, FR-10); revealing
 * flips it in 3D (rotateY 180) with a light sweep, or crossfades under reduced motion.
 */
export function PlayingCard({
  card,
  players,
  onSwapRoles,
  onReveal,
  onStartTimer,
  canAct,
}: {
  card: ActiveCardSnapshot;
  players: PlayerSnapshot[];
  onSwapRoles(): void;
  onReveal(): void;
  onStartTimer(): void;
  canAct: boolean;
}) {
  const reduced = useReduced();
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const flipped = card.revealed;
  useEffect(() => {
    if (flipped) {
      sound.flip();
      haptics.buzz(25);
    }
  }, [flipped]);

  const face = (
    <div className="sweep relative flex h-full flex-col overflow-hidden rounded-3xl border border-rose/40 bg-gradient-to-b from-[#2a0f22] to-[#12070f] p-5 shadow-glow">
      <div className="flex items-center justify-between">
        <GenreBadge genre={card.genre} />
        {card.intensity && <span className="text-xs text-mist">{t(`intensity.${card.intensity}`)}</span>}
      </div>
      <h3 className="mt-4 font-display text-2xl text-rose">{card.title}</h3>
      <p className="mt-3 flex-1 overflow-y-auto whitespace-pre-line text-base leading-relaxed text-blush" aria-live="polite">
        {card.text}
      </p>
      {card.timer && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <TimerRing timer={card.timer} dealSeq={card.dealSeq} />
          {card.timer.status !== 'running' && card.timer.remainingMs > 0 && (
            <button
              type="button"
              onClick={onStartTimer}
              disabled={!canAct}
              className="rim min-h-12 rounded-2xl border border-rose/50 bg-crimson/80 px-6 font-medium text-white"
            >
              {t('table.startTask')}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const back = (
    <div className="card-back-pattern flex h-full flex-col rounded-3xl border border-rose/40 p-5 shadow-glow">
      <GenreBadge genre={card.genre} />
      <div className="mt-auto rounded-2xl bg-ink/70 p-4 backdrop-blur">
        <p className="mb-2 font-display text-lg text-rose">{t('table.rolesTitle')}</p>
        <ul className="space-y-1 text-sm">
          {card.roles.map((r) => (
            <li key={r} className="flex justify-between gap-4">
              <span className="text-mist">{r}</span>
              <span className="font-medium text-blush">{name(card.assignment[r] ?? '')}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          {card.roles.length > 1 && (
            <button type="button" onClick={onSwapRoles} disabled={!canAct} className="min-h-12 flex-1 rounded-xl border border-rose/30 px-3 text-sm">
              {t('table.swapRoles')}
            </button>
          )}
          <button type="button" onClick={onReveal} disabled={!canAct} className="rim min-h-12 flex-1 rounded-xl bg-crimson px-3 text-sm font-semibold text-white">
            {t('table.reveal')}
          </button>
        </div>
      </div>
    </div>
  );

  if (reduced) {
    return (
      <motion.div key={`${card.dealSeq}-${flipped}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto h-[26rem] w-full max-w-sm">
        {flipped ? face : back}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={card.dealSeq}
      className="perspective mx-auto h-[26rem] w-full max-w-sm"
      initial={{ y: 80, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 120, damping: 16 }}
    >
      <motion.div
        className="preserve-3d relative h-full w-full"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <div className="backface-hidden absolute inset-0">{back}</div>
        <div className="backface-hidden absolute inset-0" style={{ transform: 'rotateY(180deg)' }}>
          {flipped && face}
        </div>
      </motion.div>
    </motion.div>
  );
}
