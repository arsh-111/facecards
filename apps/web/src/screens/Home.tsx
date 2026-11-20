import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { isValidRoomCode } from '@nc/shared';
import { t } from '../i18n';
import { api, ApiError } from '../lib/api';
import { useApp } from '../store';
import { Logo, Shell } from '../components/chrome';
import { Button, Panel } from '../components/ui';

const joinErrors: Record<string, string> = {
  NOT_FOUND: 'home.notFound',
  ROOM_FULL: 'home.full',
  IN_PROGRESS: 'home.started',
  RATE_LIMITED: 'home.rateLimited',
  INVALID_INPUT: 'home.badCode',
  UNREACHABLE: 'errors.UNREACHABLE',
};

export function Header() {
  return (
    <header className="flex items-center justify-between py-2">
      <Logo />
      <Link
        to="/settings"
        aria-label={t('common.settings')}
        className="flex h-12 w-12 items-center justify-center rounded-full text-xl text-mist hover:text-blush"
      >
        ⚙
      </Link>
    </header>
  );
}

export function Home() {
  const me = useApp((s) => s.me);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (mode: 'online' | 'pass_and_play', solo = false) => {
    setBusy(true);
    try {
      const r = await api.createRoom(mode, solo);
      navigate(`/room/${r.code}`);
    } catch (e) {
      setError(t(`errors.${e instanceof ApiError ? e.code : 'SERVER_ERROR'}`));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (!isValidRoomCode(c)) return setError(t('home.badCode'));
    setBusy(true);
    setError('');
    try {
      await api.joinRoom(c);
      navigate(`/room/${c}`);
    } catch (e) {
      setError(t(joinErrors[e instanceof ApiError ? e.code : ''] ?? 'common.error'));
    } finally {
      setBusy(false);
    }
  };

  const name = me?.profile.displayName;
  const options = [
    { key: 'solo', title: t('home.solo'), hint: t('home.soloHint'), run: () => create('pass_and_play', true) },
    { key: 'pp', title: t('home.passPlay'), hint: t('home.passPlayHint'), run: () => create('pass_and_play') },
    { key: 'create', title: t('home.create'), hint: t('home.createHint'), run: () => create('online') },
  ];

  return (
    <Shell header={<Header />}>
      <h1 className="mt-6 font-display text-3xl text-rose">
        {name ? t('home.greeting', { name }) : t('home.greetingAnon')}
      </h1>
      {me?.currentRoom && (
        <Button variant="ghost" className="mt-4" onClick={() => navigate(`/room/${me.currentRoom}`)}>
          {t('home.resume')} · {me.currentRoom}
        </Button>
      )}
      <div className="mt-6 grid gap-3">
        {options.map((o, i) => (
          <motion.button
            key={o.key}
            type="button"
            disabled={busy}
            onClick={() => void o.run()}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileTap={{ scale: 0.98 }}
            className="glass min-h-20 rounded-3xl p-5 text-left transition hover:border-rose/40 disabled:opacity-50"
          >
            <span className="block font-display text-xl text-blush">{o.title}</span>
            <span className="text-sm text-mist">{o.hint}</span>
          </motion.button>
        ))}
      </div>

      <Panel className="mt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <label className="mb-2 block font-display text-xl text-blush" htmlFor="code">
            {t('home.join')}
          </label>
          <div className="flex gap-2">
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC234"
              aria-label={t('home.codeLabel')}
              autoComplete="off"
              autoCapitalize="characters"
              className="min-h-12 w-full rounded-2xl border border-rose/20 bg-ink/60 px-4 font-mono text-xl tracking-[0.3em] text-blush"
            />
            <Button type="submit" disabled={busy || code.length !== 6}>
              {t('home.joinCta')}
            </Button>
          </div>
        </form>
      </Panel>
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-rose">
          {error}
        </p>
      )}
    </Shell>
  );
}
