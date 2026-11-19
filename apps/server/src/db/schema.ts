import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Boundaries, RoleAssignment, RolePrefs, Settings } from '@nc/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Section 6.1. No PII: no email, name (display nickname is optional/pseudonymous), IP or exact age. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    ageVerified: boolean('age_verified').notNull().default(false),
    ageBand: text('age_band').notNull(),
    gender: text('gender').notNull(),
    preference: text('preference').notNull(),
    genres: text('genres').array().notNull(),
    displayName: text('display_name'),
    settings: jsonb('settings').$type<Settings>().notNull(),
    boundaries: jsonb('boundaries').$type<Boundaries>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sessions_last_seen_idx').on(t.lastSeenAt), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Ephemeral per-room runtime (turn cursor, active card, timer, stats). */
export interface RoomRuntime {
  timerMode: 'manual' | 'auto';
  pauseOnAway: boolean;
  manualTrack: string | null;
  trackProposal: { track: string; confirmedBy: string[] } | null;
  currentPlayerId: string | null;
  turnCursor: number;
  active: {
    cardId: string;
    assignment: RoleAssignment;
    revealed: boolean;
    drawnBy: string | null;
    timer: {
      durationMs: number;
      status: 'idle' | 'running' | 'paused';
      startedAt: number | null;
      remainingMs: number;
    } | null;
  } | null;
  dealSeq: number;
  prevState: 'playing' | 'paused' | null;
  timerWasRunning: boolean;
  stats: {
    completed: number;
    skipped: number;
    byGenre: Record<string, number>;
    startedAt: number | null;
    endedAt: number | null;
  };
  kickedSessions: string[];
  noteShown: boolean;
}

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: char('code', { length: 6 }).notNull().unique(),
  hostSessionId: uuid('host_session_id').references(() => sessions.id, { onDelete: 'set null' }),
  mode: text('mode').notNull(),
  track: text('track'),
  genres: text('genres').array().notNull(),
  intensity: text('intensity'),
  turnMode: text('turn_mode').notNull(),
  state: text('state').notNull(),
  runtime: jsonb('runtime').$type<RoomRuntime>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
});

export interface LocalProfile {
  name: string;
  gender: 'man' | 'woman' | 'nonbinary';
  preference: 'men' | 'women' | 'both';
}

/**
 * Room membership. `session_id` is null for same-device Pass and Play players, whose
 * nickname/gender/preference live in `local_profile` (see DECISIONS.md).
 */
export const roomPlayers = pgTable(
  'room_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    localProfile: jsonb('local_profile').$type<LocalProfile>(),
    rolePrefs: jsonb('role_prefs').$type<RolePrefs>().notNull(),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
  },
  (t) => [unique('room_players_room_session_uq').on(t.roomId, t.sessionId)],
);

export const roomDeckState = pgTable(
  'room_deck_state',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    status: text('status').notNull(),
    position: integer('position').notNull(),
    assignedRoles: jsonb('assigned_roles').$type<RoleAssignment>(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.cardId] })],
);

/** Keyed by HMAC of a random client cookie token, never by IP. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    keyHash: text('key_hash').notNull(),
    bucket: text('bucket').notNull(),
    count: integer('count').notNull(),
    windowEnd: ts('window_end').notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyHash, t.bucket] })],
);

/** Section 13: anonymous aggregate daily counters only. */
export const metricsCounters = pgTable(
  'metrics_counters',
  {
    key: text('key').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);
