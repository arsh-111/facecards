import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { t } from '../i18n';
import { useApp } from '../store';
import { Logo, Shell } from '../components/chrome';
import { Button } from '../components/ui';

export function Landing() {
  const me = useApp((s) => s.me);
  const loaded = useApp((s) => s.meLoaded);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');

  // FR-4: returning within the session restores profile and room automatically.
  useEffect(() => {
    if (!loaded || !me) return;
    if (next?.startsWith('/')) navigate(next, { replace: true });
    else if (me.currentRoom) navigate(`/room/${me.currentRoom}`, { replace: true });
    else navigate('/home', { replace: true });
  }, [loaded, me, navigate, next]);

  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2 }}>
          <Logo size="lg" />
        </motion.div>
        <motion.p
          className="max-w-xs font-display text-xl italic text-blush/90"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 1.2 }}
        >
          {t('app.tagline')}
        </motion.p>
        <motion.div
          className="flex w-full max-w-xs flex-col gap-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 0.8 }}
        >
          <Button
            className="rim w-full text-lg"
            onClick={() => navigate(next ? `/register?next=${encodeURIComponent(next)}` : '/register')}
          >
            {t('landing.enter')}
          </Button>
          <p className="text-xs text-mist">{t('landing.adultsOnly')}</p>
          <a href="https://duckduckgo.com" rel="noreferrer noopener" className="text-sm text-mist/80 underline-offset-4 hover:underline">
            {t('landing.leave')}
          </a>
        </motion.div>
      </div>
    </Shell>
  );
}
