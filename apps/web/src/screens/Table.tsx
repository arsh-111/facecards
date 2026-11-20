import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RoomAction, RoomSnapshot } from '@nc/shared';
import { t } from '../i18n';
import { act, onRoomEvent } from '../lib/sync';
import { haptics } from '../lib/feedback';
import { triggerPanic } from '../lib/panic';
import { useApp } from '../store';
import { Deck, PlayingCard } from '../components/game';
import { Logo } from '../components/chrome';
import { Button, Panel } from '../components/ui';

const SHUFFLE_MS = 1200;

function useRun() {
  const showToast = useApp((s) => s.showToast);
  return async (event: RoomAction, payload: Record<string, unknown> = {}) => {
    const r = await act(event, payload);
    if (!r.ok && r.error) {
      const key = `errors.${r.error}`;
      showToast(t(key) === key ? t('common.error') : t(key));
    }
    return r;
  };
}

/** FR-25: calm full-screen Safe Signal for everyone. */
function SafeSignal({ onEnd }: { onEnd(): void }) {
  const run = useRun();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/80 p-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      <motion.span
        aria-hidden
        className="absolute h-72 w-72 rounded-full border border-rose/30 shadow-rose"
        initial={{ scale: 1.4, opacity: 0.8 }}
        animate={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 2.4, ease: 'easeOut' }}
      />
      <div className="relative max-w-sm space-y-6 text-center">
        <h2 id="stop-title" ref={ref} tabIndex={-1} className="font-display text-4xl text-rose">
          {t('stop.title')}
        </h2>
        <p className="text-blush/90">{t('stop.body')}</p>
        <div className="flex flex-col gap-3">
          <Button onClick={() => void run('game:resume')}>{t('stop.resume')}</Button>
          <Button variant="ghost" onClick={() => void run('card:skip')}>
            {t('stop.skip')}
          </Button>
          <Button variant="quiet" onClick={onEnd}>
            {t('stop.end')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** FR-29: responsible-use note, once per session, on first play. */
function ResponsibleNote() {
  const patchSettings = useApp((s) => s.patchSettings);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="note-title" className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-4 backdrop-blur sm:items-center">
      <Panel className="max-w-md">
        <h2 id="note-title" className="font-display text-2xl text-rose">
          {t('note.title')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-blush/90">{t('note.body')}</p>
        <Button
          className="mt-5 w-full"
          autoFocus
          onClick={() => {
            setOpen(false);
            void patchSettings({ seenNote: true });
          }}
        >
          {t('note.ok')}
        </Button>
      </Panel>
    </div>
  );
}

export function Table({ room, onEnd }: { room: RoomSnapshot; onEnd(): void }) {
  const run = useRun();
  const seenNote = useApp((s) => s.me?.profile.settings.seenNote ?? true);
  const active = room.active;
  const passPlay = room.mode === 'pass_and_play';
  const [shownSeq, setShownSeq] = useState(() => active?.dealSeq ?? 0);
  const [shuffling, setShuffling] = useState(false);
  const current = room.players.find((p) => p.id === room.currentPlayerId);
  const yourTurn = room.currentPlayerId === room.youId;
  const canDraw =
    room.state === 'playing' && !active && !room.deck.empty && (passPlay || yourTurn || room.isHost);

  // Play the shuffle -> deal sequence once per new card (all devices).
  useEffect(() => {
    if (!active || active.dealSeq === shownSeq) return;
    setShuffling(true);
    const id = setTimeout(() => {
      setShuffling(false);
      setShownSeq(active.dealSeq);
      haptics.buzz(15);
    }, SHUFFLE_MS);
    return () => clearTimeout(id);
  }, [active, shownSeq]);

  useEffect(() => onRoomEvent((ev) => ev === 'game:stopped' && haptics.buzz([40, 60, 40])), []);

  const showCard = active && active.dealSeq === shownSeq && !shuffling;
  const disabled = room.state !== 'playing';

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between py-2">
        <Logo />
        <div className="flex items-center gap-3 text-sm text-mist">
          <span aria-label={t('table.remaining', { n: room.deck.remaining })}>
            🂠 {t('table.remaining', { n: room.deck.remaining })}
          </span>
          <button type="button" onClick={() => void run('game:end')} className="min-h-12 px-2 text-rose underline-offset-4 hover:underline">
            {t('table.end')}
          </button>
        </div>
      </header>

      <p className="text-center font-display text-xl text-blush" aria-live="polite" data-testid="turn">
        {current ? (yourTurn && !passPlay ? t('table.yourTurn') : t('table.turn', { name: current.name })) : ''}
      </p>
      {room.turnMode === 'host' && room.isHost && !active && (
        <div className="mt-2 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label={t('table.nextTurn')}>
          {room.players.filter((p) => !p.away).map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === room.currentPlayerId}
              onClick={() => void run('turn:set', { playerId: p.id })}
              className={`min-h-12 rounded-full border px-3 text-sm ${p.id === room.currentPlayerId ? 'border-rose bg-wine/60' : 'border-rose/20'}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center py-6">
        <AnimatePresence mode="wait">
          {showCard && active ? (
            <PlayingCard
              key={active.dealSeq}
              card={active}
              players={room.players}
              canAct={!disabled}
              onSwapRoles={() => void run('roles:swap')}
              onReveal={() => void run('roles:confirm')}
              onStartTimer={() => void run('card:startTimer')}
            />
          ) : room.deck.empty ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 text-center">
              <p className="font-display text-2xl text-rose">{t('table.deckEmpty')}</p>
              <div className="flex gap-3">
                <Button onClick={() => void run('deck:reshuffle')}>{t('table.reshuffle')}</Button>
                <Button variant="ghost" onClick={() => void run('game:end')}>
                  {t('table.end')}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="deck" className="flex flex-col items-center gap-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}>
              <Deck shuffling={shuffling} count={room.deck.remaining} />
              {shuffling ? (
                <p className="text-mist" role="status">{t('table.drawing')}</p>
              ) : canDraw ? (
                <Button
                  className="rim text-lg"
                  data-testid="draw"
                  onClick={() => {
                    setShuffling(true);
                    void run('card:draw').then((r) => {
                      if (!r.ok) setShuffling(false);
                    });
                  }}
                >
                  {t('table.draw')}
                </Button>
              ) : (
                <p className="text-mist" role="status">
                  {current ? t('table.waitDraw', { name: current.name }) : ''}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {showCard && active?.revealed && (
          <button type="button" onClick={() => void run('card:never')} className="mt-3 min-h-12 text-xs text-mist underline-offset-4 hover:text-rose hover:underline">
            {t('table.never')}
          </button>
        )}
      </div>

      {/* Section 8.4: mandatory controls, always visible, bottom-reachable, never in a menu. */}
      <nav aria-label="Card controls" className="sticky bottom-0 z-20 -mx-4 border-t border-rose/10 bg-ink/85 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-3 gap-2 sm:grid-cols-6">
          <Button className="col-span-3 sm:col-span-2" disabled={disabled || !active?.revealed} onClick={() => void run('card:done')}>
            {t('table.done')}
          </Button>
          <Button variant="ghost" disabled={disabled || !active} onClick={() => void run('card:skip')}>
            {t('table.skip')}
          </Button>
          <Button variant="ghost" disabled={disabled || !active} onClick={() => void run('card:swap')}>
            {t('table.swap')}
          </Button>
          {room.state === 'paused' ? (
            <Button variant="ghost" onClick={() => void run('game:resume')}>
              {t('table.resume')}
            </Button>
          ) : (
            <Button variant="ghost" disabled={room.state !== 'playing'} onClick={() => void run('game:pause')}>
              {t('table.pause')}
            </Button>
          )}
          <Button variant="stop" aria-label={t('table.stopLabel')} className="col-span-2 sm:col-span-1" data-testid="stop" onClick={() => void run('game:stop')}>
            ✋ {t('table.stop')}
          </Button>
          <Button variant="danger" aria-label={t('table.hideLabel')} onClick={triggerPanic}>
            {t('table.hide')}
          </Button>
        </div>
      </nav>

      {room.state === 'paused' && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-30 flex justify-center" role="status">
          <span className="glass rounded-full px-4 py-2 text-sm">{t('table.paused')}</span>
        </div>
      )}
      <AnimatePresence>{room.state === 'stopped' && <SafeSignal onEnd={onEnd} />}</AnimatePresence>
      {!seenNote && <ResponsibleNote />}
    </div>
  );
}

export function Summary({ room, onLeave }: { room: RoomSnapshot; onLeave(): void }) {
  const run = useRun();
  const s = room.stats;
  const ms = s.startedAt && s.endedAt ? s.endedAt - s.startedAt : 0;
  const mins = Math.max(0, Math.round(ms / 60000));
  const time = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  return (
    <motion.div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="font-display text-4xl text-rose">{t('summary.title')}</h1>
      <Panel className="w-full max-w-sm">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-mist">{t('summary.completed')}</dt>
            <dd className="font-display text-3xl text-blush">{s.completed}</dd>
          </div>
          <div>
            <dt className="text-xs text-mist">{t('summary.skipped')}</dt>
            <dd className="font-display text-3xl text-blush">{s.skipped}</dd>
          </div>
          <div>
            <dt className="text-xs text-mist">{t('summary.time')}</dt>
            <dd className="font-display text-3xl text-blush">{time}</dd>
          </div>
        </dl>
        {Object.keys(s.byGenre).length > 0 && (
          <ul className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-mist">
            {Object.entries(s.byGenre).map(([g, n]) => (
              <li key={g} className="rounded-full border border-rose/20 px-3 py-1">
                {t(`genre.${g}`)}: {n}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {room.isHost ? (
          <Button onClick={() => void run('room:playAgain')}>{t('summary.again')}</Button>
        ) : (
          <p className="text-sm text-mist">{t('summary.waitingHost')}</p>
        )}
        <Button variant="ghost" onClick={onLeave}>
          {t('summary.end')}
        </Button>
      </div>
    </motion.div>
  );
}
