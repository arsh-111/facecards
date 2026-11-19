export const GENRES = ['erotic', 'oral', 'anal', 'threesome', 'group', 'master_slave'] as const;
export type Genre = (typeof GENRES)[number];

/** Section 5.2: minimum players per genre. */
export const GENRE_MIN_PLAYERS: Record<Genre, number> = {
  erotic: 2,
  oral: 2,
  anal: 2,
  threesome: 3,
  group: 4,
  master_slave: 2,
};

export const GENDERS = ['man', 'woman', 'nonbinary'] as const;
export type Gender = (typeof GENDERS)[number];

export const PREFERENCES = ['men', 'women', 'both'] as const;
export type Preference = (typeof PREFERENCES)[number];

export const INTENSITIES = ['warm', 'hot', 'intense'] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const TURN_MODES = ['alternate', 'random', 'host'] as const;
export type TurnMode = (typeof TURN_MODES)[number];

export const TIMER_MODES = ['manual', 'auto'] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

export const ROOM_MODES = ['online', 'pass_and_play'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export const ROOM_STATES = ['lobby', 'playing', 'paused', 'stopped', 'ended'] as const;
export type RoomState = (typeof ROOM_STATES)[number];

export const DECK_STATUSES = ['unseen', 'active', 'done', 'skipped'] as const;
export type DeckStatus = (typeof DECK_STATUSES)[number];

/** FR-10 role placeholders. */
export const ROLE_KEYS = ['giver', 'receiver', 'top', 'bottom', 'master', 'slave', 'A', 'B', 'C'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** FR-19: 32 characters, A-Z and 2-9 without ambiguous I, O, 0, 1. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** FR-20 */
export const COUPLE_MAX_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 8;

export const AGE_BANDS = ['18-24', '25-34', '35-44', '45+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const MIN_AGE = 18;

/** Section 7.6: reconnect window before a player is marked away. */
export const RECONNECT_GRACE_MS = 2 * 60 * 1000;
