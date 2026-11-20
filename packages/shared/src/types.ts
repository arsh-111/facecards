import type {
  Gender,
  Genre,
  Intensity,
  Preference,
  RoomMode,
  RoomState,
  TimerMode,
  TurnMode,
} from './constants';
import type { RoleAssignment, RolePrefs } from './roles';

export interface TimerSnapshot {
  durationMs: number;
  status: 'idle' | 'running' | 'paused';
  /** Server epoch ms when the timer (re)started running. */
  startedAt: number | null;
  /** Remaining ms at `startedAt` (or now, when paused/idle). */
  remainingMs: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  isHost: boolean;
  isYou: boolean;
  local: boolean;
  connected: boolean;
  away: boolean;
  gender: Gender;
  preference: Preference;
  rolePrefs: RolePrefs;
}

export interface ActiveCardSnapshot {
  cardId: string;
  genre: Genre;
  roles: string[];
  assignment: RoleAssignment;
  revealed: boolean;
  /** Present only once roles are confirmed and the card is revealed. */
  title: string | null;
  text: string | null;
  intensity: Intensity | null;
  timer: TimerSnapshot | null;
  drawnBy: string | null;
  /** Monotonic counter so clients can replay deal/flip animations exactly once. */
  dealSeq: number;
}

export interface RoomStats {
  completed: number;
  skipped: number;
  byGenre: Partial<Record<Genre, number>>;
  startedAt: number | null;
  endedAt: number | null;
}

export interface RoomSnapshot {
  code: string;
  mode: RoomMode;
  state: RoomState;
  youId: string | null;
  isHost: boolean;
  players: PlayerSnapshot[];
  maxPlayers: number;
  track: string | null;
  resolvedTrack: string | null;
  trackProposal: { track: string; confirmedBy: string[] } | null;
  knownTracks: { track: string; label: string }[];
  availableGenres: Genre[];
  genres: Genre[];
  intensity: Intensity | null;
  intensityAvailable: boolean;
  turnMode: TurnMode;
  timerMode: TimerMode;
  pauseOnAway: boolean;
  currentPlayerId: string | null;
  active: ActiveCardSnapshot | null;
  deck: { total: number; remaining: number; empty: boolean };
  stats: RoomStats;
  serverNow: number;
  /** Increments on every saved change; lets clients skip re-rendering identical states. */
  version: number;
  showResponsibleNote: boolean;
  /** Reasons the host cannot start yet (i18n keys). */
  blockers: string[];
}

export interface AckResponse {
  ok: boolean;
  error?: string;
}
