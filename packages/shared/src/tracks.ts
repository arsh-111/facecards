import type { Gender, Preference } from './constants';

export interface TrackPlayer {
  gender: Gender;
  preference: Preference;
}

type BinaryGender = 'man' | 'woman';
export interface ResolvedPlayer {
  gender: BinaryGender;
  preference: Preference;
}

export interface TrackRule {
  /** Must equal the `track` value used in cards.json. */
  track: string;
  /** Human label (UI). */
  label: string;
  matches(players: ResolvedPlayer[]): boolean;
}

export function attractedTo(pref: Preference, gender: BinaryGender): boolean {
  return (
    pref === 'both' || (pref === 'men' && gender === 'man') || (pref === 'women' && gender === 'woman')
  );
}

/**
 * Section 5.1 track-resolution table. To add a track (e.g. `lesbian`): add a rule here, add
 * cards with that `track` to data/cards.json, and add tests. No other code changes are needed.
 */
export const TRACK_RULES: readonly TrackRule[] = [
  {
    track: 'gay',
    label: 'Gay',
    matches: (ps) =>
      ps.length >= 2 && ps.every((p) => p.gender === 'man' && attractedTo(p.preference, 'man')),
  },
  {
    track: 'straight',
    label: 'Straight',
    matches: (ps) => {
      const men = ps.filter((p) => p.gender === 'man');
      const women = ps.filter((p) => p.gender === 'woman');
      if (ps.length < 2 || men.length === 0 || women.length === 0) return false;
      return (
        men.every((m) => attractedTo(m.preference, 'woman')) &&
        women.every((w) => attractedTo(w.preference, 'man'))
      );
    },
  },
];

export function knownTracks(rules: readonly TrackRule[] = TRACK_RULES): string[] {
  return rules.map((r) => r.track);
}

export function trackLabel(track: string, rules: readonly TrackRule[] = TRACK_RULES): string {
  return rules.find((r) => r.track === track)?.label ?? track;
}

/**
 * Resolve the deck track for a set of players. Non-binary players are matched by their stated
 * preference: every man/woman interpretation is tried and the first rule (in table order) that
 * fits wins. Returns null when nothing fits ("No matching deck").
 */
export function resolveTrack(
  players: readonly TrackPlayer[],
  rules: readonly TrackRule[] = TRACK_RULES,
): string | null {
  if (players.length < 2) return null;
  const nbIdx = players.flatMap((p, i) => (p.gender === 'nonbinary' ? [i] : []));
  const combos = 1 << nbIdx.length;
  for (const rule of rules) {
    for (let mask = 0; mask < combos; mask++) {
      const resolved: ResolvedPlayer[] = players.map((p, i) => {
        if (p.gender !== 'nonbinary') return { gender: p.gender, preference: p.preference };
        const bit = nbIdx.indexOf(i);
        return { gender: mask & (1 << bit) ? 'woman' : 'man', preference: p.preference };
      });
      if (rule.matches(resolved)) return rule.track;
    }
  }
  return null;
}
