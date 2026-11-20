import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { api } from '../lib/api';
import { act, connectRoom, disconnectRoom, rejoin } from '../lib/sync';
import { useApp } from '../store';
import { Shell } from '../components/chrome';
import { Button, Panel } from '../components/ui';
import { Header } from './Home';
import { Lobby } from './Lobby';
import { Summary, Table } from './Table';

function Notice({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Panel className="w-full max-w-sm space-y-4 text-center">
        <p className="font-display text-2xl text-rose">{text}</p>
        {children}
      </Panel>
    </div>
  );
}

export function RoomScreen() {
  const { code = '' } = useParams();
  const upper = code.toUpperCase();
  const navigate = useNavigate();
  const room = useApp((s) => s.room);
  const conn = useApp((s) => s.conn);
  const loadMe = useApp((s) => s.loadMe);

  useEffect(() => {
    connectRoom(upper);
    return () => disconnectRoom();
  }, [upper]);

  const leave = async () => {
    disconnectRoom(); // stop polling first so the screen doesn't flash "not in this room"
    await api.leaveRoom(upper).catch(() => {});
    await loadMe();
    navigate('/home', { replace: true });
  };
  const home = () => {
    disconnectRoom();
    void loadMe();
    navigate('/home', { replace: true });
  };
  const end = () => void act('game:end');

  let body: React.ReactNode;
  if (conn === 'expired') {
    body = (
      <Notice text={t('room.expired')}>
        <Button onClick={() => navigate('/', { replace: true })}>{t('common.home')}</Button>
      </Notice>
    );
  } else if (conn === 'kicked' || conn === 'closed') {
    body = (
      <Notice text={t(conn === 'kicked' ? 'room.kicked' : 'room.closed')}>
        <Button onClick={home}>{t('room.backHome')}</Button>
      </Notice>
    );
  } else if (conn === 'notMember') {
    body = (
      <Notice text={t('room.notMember')}>
        <Button
          onClick={() =>
            void api
              .joinRoom(upper)
              .then(rejoin)
              .catch(() => useApp.getState().setConn('closed'))
          }
        >
          {t('room.joinThis')}
        </Button>
        <Button variant="quiet" onClick={home}>
          {t('room.backHome')}
        </Button>
      </Notice>
    );
  } else if (conn === 'superseded') {
    body = (
      <Notice text={t('room.superseded')}>
        <Button onClick={rejoin}>{t('room.playHere')}</Button>
      </Notice>
    );
  } else if (!room || room.code !== upper) {
    body = (
      <p className="m-auto text-mist" role="status">
        {conn === 'offline' ? t('common.offline') : t('common.loading')}
      </p>
    );
  } else if (room.state === 'lobby') {
    body = <Lobby room={room} onLeave={() => void leave()} />;
  } else if (room.state === 'ended') {
    body = <Summary room={room} onLeave={() => void leave()} />;
  } else {
    body = <Table room={room} onEnd={end} />;
  }

  const playing = room && ['playing', 'paused', 'stopped'].includes(room.state) && conn !== 'superseded';
  return (
    <Shell header={playing ? undefined : <Header />} footer={false}>
      {conn === 'offline' && room && (
        <p role="status" className="mb-2 rounded-xl bg-wine/40 px-3 py-2 text-center text-sm">
          {t('common.offline')}
        </p>
      )}
      {body}
    </Shell>
  );
}
