import { describe, expect, it } from 'vitest';
import type { Card } from '@nc/shared';
import * as E from '../src/rooms/engine';

const cards: Card[] = [
  { id: 'gay-oral-01', track: 'gay', genre: 'oral', title: 'O1', text: '{giver} / {receiver}', roles: ['giver', 'receiver'], minPlayers: 2, durationSeconds: 60 },
  { id: 'gay-oral-02', track: 'gay', genre: 'oral', title: 'O2', text: '{giver} / {receiver}', roles: ['giver', 'receiver'], minPlayers: 2 },
  { id: 'gay-anal-01', track: 'gay', genre: 'anal', title: 'A1', text: '{top} / {bottom}', roles: ['top', 'bottom'], minPlayers: 2 },
];

function setup() {
  const sessions: Record<string, E.SessionInfo> = {
    s1: { displayName: 'Sam', gender: 'man', preference: 'men', genres: ['oral', 'anal'], boundaries: { neverGenres: [], neverCardIds: [] }, seenNote: true },
    s2: { displayName: 'Ari', gender: 'man', preference: 'both', genres: ['oral', 'anal'], boundaries: { neverGenres: [], neverCardIds: [] }, seenNote: true },
  };
  let now = 1_000_000;
  const ctx = (): E.EngineCtx => ({
    cards: { all: cards, byId: new Map(cards.map((c) => [c.id, c])) },
    session: (id) => sessions[id],
    rng: () => 0.42,
    now,
  });
  const room: E.Room = {
    id: 'r', code: 'ABCDEF', mode: 'online', hostPlayerId: 'p1', track: null, genres: [], genresTouched: false,
    intensity: null, turnMode: 'alternate', state: 'lobby', runtime: E.newRuntime(), createdAt: now, lastActivityAt: now,
    players: [E.newPlayer('p1', 's1', now)], deck: [],
  };
  return { room, ctx, sessions, tick: (ms: number) => (now += ms) };
}

describe('room engine', () => {
  it('blocks start until two players, a track and genres exist', () => {
    const { room, ctx } = setup();
    expect(E.blockers(room, ctx())).toContain('needPlayers');
    E.join(room, ctx(), 's2', 'p2');
    expect(E.blockers(room, ctx())).toEqual([]);
    expect(room.genres).toEqual(['oral', 'anal']);
  });

  it('only the host can start; deck honors genres and boundaries', () => {
    const { room, ctx, sessions } = setup();
    E.join(room, ctx(), 's2', 'p2');
    (sessions.s2 as E.SessionInfo).boundaries.neverCardIds = ['gay-oral-02'];
    expect(() => E.start(room, ctx(), 'p2')).toThrow('HOST_ONLY');
    E.setGenres(room, ctx(), 'p1', ['oral']);
    E.start(room, ctx(), 'p1');
    expect(room.state).toBe('playing');
    expect(room.track).toBe('gay');
    expect(room.deck.map((d) => d.cardId)).toEqual(['gay-oral-01']);
  });

  it('draw -> confirm roles -> timer -> done, and each card is dealt at most once (FR-9)', () => {
    const { room, ctx, tick } = setup();
    E.join(room, ctx(), 's2', 'p2');
    E.start(room, ctx(), 'p1');
    const first = room.runtime.currentPlayerId as string;
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const actor = room.runtime.currentPlayerId as string;
      E.draw(room, ctx(), actor);
      const a = room.runtime.active as NonNullable<typeof room.runtime.active>;
      expect(seen.has(a.cardId)).toBe(false);
      seen.add(a.cardId);
      // card text is hidden until roles are confirmed
      expect(E.snapshot(room, ctx(), 's1').active?.text).toBeNull();
      E.rolesConfirm(room, ctx());
      expect(E.snapshot(room, ctx(), 's1').active?.text).toMatch(/Sam|Ari/);
      if (a.timer) {
        E.startTimer(room, ctx());
        tick(10_000);
        E.pause(room, ctx());
        expect(room.runtime.active?.timer?.remainingMs).toBe(50_000);
        E.resume(room, ctx());
      }
      E.done(room, ctx());
    }
    expect(room.runtime.stats.completed).toBe(3);
    expect(room.runtime.currentPlayerId).not.toBe(first); // alternated 3 times
    expect(() => E.draw(room, ctx(), room.runtime.currentPlayerId as string)).toThrow('DECK_EMPTY');
    expect(E.snapshot(room, ctx(), 's1').deck.empty).toBe(true);
    E.reshuffle(room, ctx());
    expect(room.deck.filter((d) => d.status === 'unseen')).toHaveLength(3);
  });

  it('online: only the current player (or host) may draw', () => {
    const { room, ctx } = setup();
    E.join(room, ctx(), 's2', 'p2');
    E.start(room, ctx(), 'p1');
    room.runtime.currentPlayerId = 'p1';
    expect(() => E.draw(room, ctx(), 'p2')).toThrow('NOT_YOUR_TURN');
  });

  it('Stop pauses the timer for everyone and resumes it; it is never counted (FR-25, FR-26)', () => {
    const { room, ctx, tick } = setup();
    E.join(room, ctx(), 's2', 'p2');
    E.setGenres(room, ctx(), 'p1', ['oral']);
    room.runtime.timerMode = 'auto';
    E.start(room, ctx(), 'p1');
    E.draw(room, ctx(), room.runtime.currentPlayerId as string);
    // force the timed card for determinism
    if (!room.runtime.active?.timer) {
      E.skip(room, ctx());
      E.draw(room, ctx(), room.runtime.currentPlayerId as string);
    }
    E.rolesConfirm(room, ctx());
    expect(room.runtime.active?.timer?.status).toBe('running');
    tick(5000);
    E.stop(room, ctx());
    expect(room.state).toBe('stopped');
    expect(room.runtime.active?.timer?.status).toBe('paused');
    E.resume(room, ctx());
    expect(room.state).toBe('playing');
    expect(room.runtime.active?.timer?.status).toBe('running');
    const statsBefore = { ...room.runtime.stats };
    E.stop(room, ctx());
    E.skip(room, ctx()); // "Skip card" from the safe-signal screen
    expect(room.state).toBe('playing');
    expect(room.runtime.stats.completed).toBe(statsBefore.completed);
    expect(Object.keys(room.runtime.stats)).not.toContain('stops');
  });

  it('swap draws a replacement from the same genre', () => {
    const { room, ctx } = setup();
    E.join(room, ctx(), 's2', 'p2');
    E.setGenres(room, ctx(), 'p1', ['oral']);
    E.start(room, ctx(), 'p1');
    E.draw(room, ctx(), room.runtime.currentPlayerId as string);
    const before = room.runtime.active?.cardId;
    E.swap(room, ctx());
    expect(room.runtime.active?.cardId).not.toBe(before);
    expect(room.runtime.active?.cardId).toMatch(/^gay-oral/);
    expect(() => E.swap(room, ctx())).toThrow('NO_SWAP');
  });

  it('host leaving passes host to the longest-present player (FR-23)', () => {
    const { room, ctx, tick } = setup();
    tick(1);
    E.join(room, ctx(), 's2', 'p2');
    expect(E.removePlayer(room, ctx(), 'p1')).toBe(true);
    expect(room.hostPlayerId).toBe('p2');
  });

  it('kicked players cannot rejoin', () => {
    const { room, ctx } = setup();
    E.join(room, ctx(), 's2', 'p2');
    E.kick(room, ctx(), 'p1', 'p2');
    expect(() => E.join(room, ctx(), 's2', 'p3')).toThrow('KICKED');
  });

  it('no matching deck needs every player to confirm a manual track', () => {
    const { room, ctx, sessions } = setup();
    (sessions.s2 as E.SessionInfo).preference = 'women';
    E.join(room, ctx(), 's2', 'p2');
    expect(E.blockers(room, ctx())).toContain('noTrack');
    E.proposeTrack(room, ctx(), 'p1', 'gay');
    expect(E.blockers(room, ctx())).toContain('noTrack');
    E.confirmTrack(room, 'p2');
    expect(E.blockers(room, ctx())).toEqual([]);
  });
});
