import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isValidRoomCode } from '@nc/shared';
import { t } from '../i18n';
import { api, ApiError } from '../lib/api';
import { useApp } from '../store';
import { Shell } from '../components/chrome';

/** Shareable link `/join/:code` (FR-19). Unregistered visitors register first, then return. */
export function JoinLink() {
  const { code = '' } = useParams();
  const me = useApp((s) => s.me);
  const loaded = useApp((s) => s.meLoaded);
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const upper = code.toUpperCase();

  useEffect(() => {
    if (!loaded || !me || !isValidRoomCode(upper)) return;
    api
      .joinRoom(upper)
      .then(() => setTarget(`/room/${upper}`))
      .catch((e) => setError(e instanceof ApiError && e.code === 'NOT_FOUND' ? t('home.notFound') : t('common.error')));
  }, [loaded, me, upper]);

  if (!isValidRoomCode(upper)) return <Navigate to="/" replace />;
  if (loaded && !me) return <Navigate to={`/?next=${encodeURIComponent(`/join/${upper}`)}`} replace />;
  if (target) return <Navigate to={target} replace />;
  return (
    <Shell>
      <p className="m-auto text-mist" role="status">
        {error || t('common.loading')}
      </p>
    </Shell>
  );
}
