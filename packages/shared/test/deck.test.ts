import { describe, expect, it } from 'vitest';
import {
  availableGenres,
  filterDeck,
  genresPlayableFor,
  intersectGenres,
  shuffle,
} from '../src/deck';
import { CardsFileSchema, DisplayNameSchema, type Card } from '../src/schemas';
import { ageBand, ageFromDob, isAdult } from '../src/age';
import { generateRoomCode, isValidRoomCode } from '../src/roomCode';
import { ROOM_CODE_ALPHABET } from '../src/constants';

const card = (over: Partial<Card> & Pick<Card, 'id' | 'track' | 'genre'>): Card => ({
  title: 't',
  text: 'PLACEHOLDER',
  roles: ['A', 'B'],
  minPlayers: 2,
  ...over,
});

const CARDS: Card[] = [
  card({ id: 'gay-oral-01', track: 'gay', genre: 'oral', intensity: 'warm' }),
  card({ id: 'gay-oral-02', track: 'gay', genre: 'oral', intensity: 'intense' }),
  card({ id: 'gay-anal-01', track: 'gay', genre: 'anal' }),
  card({ id: 'straight-oral-01', track: 'straight', genre: 'oral' }),
  card({
    id: 'gay-threesome-01',
    track: 'gay',
    genre: 'threesome',
    roles: ['A', 'B', 'C'],
    minPlayers: 3,
  }),
];

const baseFilter = {
  track: 'gay',
  genres: ['oral', 'anal', 'threesome'] as const,
  playerCount: 2,
  maxIntensity: null,
  neverGenres: [],
  neverCardIds: [],
};

describe('genre logic (FR-7, FR-8, FR-20)', () => {
  it('couple genres only for exactly two players; group genres need their minimum', () => {
    expect(genresPlayableFor(1)).toEqual([]);
    expect(genresPlayableFor(2)).toEqual(['erotic', 'oral', 'anal', 'master_slave']);
    expect(genresPlayableFor(3)).toEqual(['threesome']);
    expect(genresPlayableFor(4)).toEqual(['threesome', 'group']);
  });

  it('intersects player genres', () => {
    expect(intersectGenres([['oral', 'anal'], ['anal', 'erotic']])).toEqual(['anal']);
    expect(intersectGenres([['oral'], ['anal']])).toEqual([]);
    expect(intersectGenres([])).toEqual([]);
  });

  it('available genres exclude never-genres and unplayable genres', () => {
    expect(
      availableGenres({
        playerGenres: [
          ['oral', 'anal', 'threesome'],
          ['oral', 'anal', 'threesome'],
        ],
        playerCount: 2,
        neverGenres: ['anal'],
      }),
    ).toEqual(['oral']);
  });
});

describe('filterDeck', () => {
  it('filters by track, genre and player count', () => {
    expect(filterDeck(CARDS, baseFilter).map((c) => c.id)).toEqual([
      'gay-oral-01',
      'gay-oral-02',
      'gay-anal-01',
    ]);
    expect(filterDeck(CARDS, { ...baseFilter, playerCount: 3 }).map((c) => c.id)).toContain(
      'gay-threesome-01',
    );
  });

  it('honors boundaries (FR-27)', () => {
    const ids = filterDeck(CARDS, {
      ...baseFilter,
      neverGenres: ['anal'],
      neverCardIds: ['gay-oral-02'],
    }).map((c) => c.id);
    expect(ids).toEqual(['gay-oral-01']);
  });

  it('applies max intensity but keeps cards without intensity (FR-18)', () => {
    const ids = filterDeck(CARDS, { ...baseFilter, maxIntensity: 'hot' }).map((c) => c.id);
    expect(ids).toEqual(['gay-oral-01', 'gay-anal-01']);
  });
});

describe('shuffle', () => {
  it('is a permutation', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const out = shuffle([1, 2, 3, 4, 5, 6], rng);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('cards file schema', () => {
  it('rejects mismatched ids, unknown placeholders and duplicates', () => {
    const bad = (c: unknown) => CardsFileSchema.safeParse({ version: 1, cards: [c] }).success;
    expect(bad({ ...CARDS[0], id: 'straight-oral-01' })).toBe(false);
    expect(bad({ ...CARDS[0], text: 'hi {top}' })).toBe(false);
    expect(bad({ ...CARDS[0], text: 'hi {A} and {B}' })).toBe(true);
    expect(
      CardsFileSchema.safeParse({ version: 1, cards: [CARDS[0], CARDS[0]] }).success,
    ).toBe(false);
  });
});

describe('age', () => {
  it('bands ages without storing exact age', () => {
    expect(ageBand(18)).toBe('18-24');
    expect(ageBand(30)).toBe('25-34');
    expect(ageBand(44)).toBe('35-44');
    expect(ageBand(70)).toBe('45+');
  });
  it('computes age from dob around birthdays', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(ageFromDob('2008-06-15', now)).toBe(18);
    expect(ageFromDob('2008-06-16', now)).toBe(17);
    expect(ageFromDob('2008-02-30', now)).toBeNull();
    expect(ageFromDob('2030-01-01', now)).toBeNull();
    expect(isAdult(17)).toBe(false);
    expect(isAdult(18)).toBe(true);
  });
});

describe('display names', () => {
  const ok = (s: string) => DisplayNameSchema.safeParse(s).success;
  it('accepts names in many scripts, including combining vowel signs', () => {
    for (const n of ['Sam', 'Zoë', 'José', 'प्रिया', 'অনিক', 'தமிழ்', 'Anna-Maria', "O'Neil", 'J.D.', 'Sam_01', '  Sam  ']) {
      expect(ok(n), n).toBe(true);
    }
  });
  it('rejects too short, too long, symbols, and names with no letter', () => {
    for (const n of ['A', 'x'.repeat(21), 'Sam!', 'Love❤', '<b>', '12', '--']) {
      expect(ok(n), n).toBe(false);
    }
  });
});

describe('room codes', () => {
  it('uses the 32-char unambiguous alphabet', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    const code = generateRoomCode((n) => Math.floor(Math.random() * n));
    expect(isValidRoomCode(code)).toBe(true);
    expect(isValidRoomCode('ABCDE0')).toBe(false);
  });
});
