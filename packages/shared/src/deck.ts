import {
  COUPLE_MAX_PLAYERS,
  GENRES,
  GENRE_MIN_PLAYERS,
  INTENSITIES,
  type Genre,
  type Intensity,
} from './constants';
import type { Card } from './schemas';

/**
 * Genres playable with `n` players. Couple genres (min 2) are only offered to exactly two
 * players (FR-20); group genres need at least their minimum (FR-8).
 */
export function genresPlayableFor(n: number): Genre[] {
  return GENRES.filter((g) => {
    const min = GENRE_MIN_PLAYERS[g];
    if (n < min) return false;
    return min > COUPLE_MAX_PLAYERS || n === COUPLE_MAX_PLAYERS;
  });
}

export function intersectGenres(lists: readonly (readonly Genre[])[]): Genre[] {
  if (lists.length === 0) return [];
  return GENRES.filter((g) => lists.every((l) => l.includes(g)));
}

export interface AvailableGenresInput {
  playerGenres: readonly (readonly Genre[])[];
  playerCount: number;
  neverGenres: readonly Genre[];
}

/** FR-7 + FR-8 + FR-27: genres every player chose, playable at this size, nobody marked Never. */
export function availableGenres(input: AvailableGenresInput): Genre[] {
  const playable = genresPlayableFor(input.playerCount);
  return intersectGenres(input.playerGenres).filter(
    (g) => playable.includes(g) && !input.neverGenres.includes(g),
  );
}

export function intensityRank(i: Intensity): number {
  return INTENSITIES.indexOf(i);
}

export function deckHasIntensity(cards: readonly Card[]): boolean {
  return cards.some((c) => c.intensity !== undefined);
}

export interface DeckFilter {
  track: string;
  genres: readonly Genre[];
  playerCount: number;
  /** Maximum intensity included; null = any. Cards without intensity are always included. */
  maxIntensity: Intensity | null;
  neverGenres: readonly Genre[];
  neverCardIds: readonly string[];
}

export function filterDeck(cards: readonly Card[], f: DeckFilter): Card[] {
  return cards.filter(
    (c) =>
      c.track === f.track &&
      f.genres.includes(c.genre) &&
      c.minPlayers <= f.playerCount &&
      c.roles.length <= f.playerCount &&
      !f.neverGenres.includes(c.genre) &&
      !f.neverCardIds.includes(c.id) &&
      (f.maxIntensity === null ||
        c.intensity === undefined ||
        intensityRank(c.intensity) <= intensityRank(f.maxIntensity)),
  );
}

/** Fisher-Yates using an injected RNG returning [0, 1). */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
