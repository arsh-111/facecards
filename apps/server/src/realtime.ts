import { parse as parseCookie } from 'cookie';
import { Server, type Socket } from 'socket.io';
import { WS_EVENTS, type AckResponse, type WsEvent } from '@nc/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app';
import { findSessionById, findSessionByToken } from './sessions';
import { SocketLimiter } from './rateLimit';
import { EngineError, type Room } from './rooms/engine';
import type { RoomEvent } from './rooms/service';

interface SocketData {
  sessionId: string;
  roomId: string | null;
  limiter: SocketLimiter;
}
type PlaySocket = Socket & { data: SocketData };

export interface Realtime {
  io: Server;
  disconnectSession(sessionId: string): void;
  close(): Promise<void>;
}

/** Section 7.5 + 11.4: Socket.IO namespace `/play`, cookie-authenticated. */
export async function attachRealtime(app: FastifyInstance, deps: AppDeps): Promise<Realtime> {
  const { db, cfg, rooms, log } = deps;
  const io = new Server(app.server, {
    serveClient: false,
    cors: { origin: cfg.allowedOrigins, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || cfg.allowedOrigins.includes(origin));
    },
    maxHttpBufferSize: 16 * 1024,
  });

  if (cfg.redisAdapter && cfg.redisUrl) {
    // Feature-flagged horizontal-scale path (Section 9). Room state is still single-writer
    // in-process; see DECISIONS.md before running more than one instance.
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pub = createClient({ url: cfg.redisUrl });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
  }

  const nsp = io.of('/play');
  const activeSocket = new Map<string, string>(); // `${roomId}:${sessionId}` -> socket.id
  const key = (roomId: string, sessionId: string) => `${roomId}:${sessionId}`;

  nsp.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.request.headers.cookie ?? '');
      const s = await findSessionByToken(db, cookies[cfg.sessionCookie], cfg);
      if (!s || !s.ageVerified) {
        const err = new Error('UNAUTHORIZED') as Error & { data?: unknown };
        err.data = { status: 401 };
        return next(err);
      }
      rooms.cacheSession(s);
      const data = socket.data as SocketData;
      data.sessionId = s.id;
      data.roomId = null;
      data.limiter = new SocketLimiter(20);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  const broadcast = async (room: Room, events: RoomEvent[]) => {
    const sockets = await nsp.in(room.id).fetchSockets();
    for (const s of sockets) {
      const sid = (s.data as SocketData).sessionId;
      const kicked = events.find((e) => e.type === 'room:kicked' && e.payload.sessionId === sid);
      if (kicked) {
        s.emit('room:kicked');
        s.leave(room.id);
        continue;
      }
      // Card content only to live, verified members of this room (Hard Rule 1).
      if (!rooms.isMember(room, sid) || !rooms.isSessionLive(sid)) {
        s.leave(room.id);
        continue;
      }
      for (const e of events) if (e.type !== 'room:kicked') s.emit(e.type, e.payload);
      s.emit('room:state', rooms.snapshotFor(room, sid));
    }
  };
  rooms.onChange = (room, events) => {
    void broadcast(room, events).catch(() => {});
  };
  rooms.onClosed = (roomId) => {
    nsp.in(roomId).emit('room:closed');
    nsp.in(roomId).socketsLeave(roomId);
  };

  const expire = (socket: PlaySocket) => {
    socket.emit('session:expired');
    socket.disconnect(true);
  };

  nsp.on('connection', (raw) => {
    const socket = raw as unknown as PlaySocket;
    const data = socket.data;

    for (const event of WS_EVENTS) {
      socket.on(event, async (payload: unknown, ack?: (r: AckResponse) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!data.limiter.take()) return reply({ ok: false, error: 'RATE_LIMITED' });
        try {
          const session = await findSessionById(db, data.sessionId, cfg);
          if (!session || !session.ageVerified) return expire(socket);
          rooms.cacheSession(session);

          if (event === 'room:join') {
            const code = (payload as { code?: unknown })?.code;
            const room = typeof code === 'string' ? await rooms.getByCode(code.toUpperCase()) : null;
            if (!room || !rooms.isMember(room, session.id)) {
              return reply({ ok: false, error: 'NOT_MEMBER' });
            }
            if (data.roomId && data.roomId !== room.id) await socket.leave(data.roomId);
            await socket.join(room.id);
            data.roomId = room.id;
            const k = key(room.id, session.id);
            const prev = activeSocket.get(k);
            if (prev && prev !== socket.id) {
              const old = nsp.sockets.get(prev) as unknown as PlaySocket | undefined;
              if (old) {
                old.emit('room:superseded');
                await old.leave(room.id);
                old.data.roomId = null;
              }
            }
            activeSocket.set(k, socket.id);
            await rooms.connected(room, session.id);
            return reply({ ok: true });
          }

          if (!data.roomId) return reply({ ok: false, error: 'NOT_IN_ROOM' });
          if (activeSocket.get(key(data.roomId, session.id)) !== socket.id) {
            return reply({ ok: false, error: 'SUPERSEDED' });
          }
          const room = await rooms.getById(data.roomId);
          if (!room) return reply({ ok: false, error: 'NOT_FOUND' });
          await rooms.act(room, session, event as WsEvent, payload);
          if (event === 'room:leave') {
            activeSocket.delete(key(room.id, session.id));
            await socket.leave(room.id);
            data.roomId = null;
          }
          reply({ ok: true });
        } catch (e) {
          if (e instanceof EngineError) {
            reply({ ok: false, error: e.code });
            // resync the caller with the authoritative state
            const room = data.roomId ? await rooms.getById(data.roomId).catch(() => null) : null;
            if (room && rooms.isMember(room, data.sessionId)) {
              socket.emit('room:state', rooms.snapshotFor(room, data.sessionId));
            }
          } else {
            log.error({ event, err: (e as Error).name }, 'ws handler failed');
            reply({ ok: false, error: 'SERVER_ERROR' });
          }
        }
      });
    }

    socket.on('disconnect', () => {
      const roomId = data.roomId;
      if (!roomId) return;
      const k = key(roomId, data.sessionId);
      if (activeSocket.get(k) !== socket.id) return;
      activeSocket.delete(k);
      void rooms
        .getById(roomId)
        .then((room) => room && rooms.disconnected(room, data.sessionId))
        .catch(() => {});
    });
  });

  // Section 7.5: re-validate sockets so expired sessions are disconnected promptly.
  const sweep = setInterval(() => {
    void (async () => {
      for (const [, raw] of nsp.sockets) {
        const s = raw as unknown as PlaySocket;
        const row = await findSessionById(db, s.data.sessionId, cfg, Date.now(), false).catch(() => null);
        if (!row) expire(s);
      }
    })();
  }, 60 * 1000);
  sweep.unref();

  return {
    io,
    disconnectSession(sessionId: string) {
      for (const [, raw] of nsp.sockets) {
        const s = raw as unknown as PlaySocket;
        if (s.data.sessionId === sessionId) expire(s);
      }
    },
    async close() {
      clearInterval(sweep);
      // Fastify owns the HTTP server; only tear down Socket.IO's own resources here.
      io.disconnectSockets(true);
      io.engine.close();
    },
  };
}
