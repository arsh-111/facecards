import { describe, expect, it } from 'vitest';
import { resolveTrack, TRACK_RULES, attractedTo, type TrackRule } from '../src/tracks';

const man = (preference: 'men' | 'women' | 'both') => ({ gender: 'man' as const, preference });
const woman = (preference: 'men' | 'women' | 'both') => ({ gender: 'woman' as const, preference });
const nb = (preference: 'men' | 'women' | 'both') => ({ gender: 'nonbinary' as const, preference });

describe('resolveTrack (Section 5.1)', () => {
  it('needs at least two players', () => {
    expect(resolveTrack([man('men')])).toBeNull();
    expect(resolveTrack([])).toBeNull();
  });

  it('two men who prefer men or both -> gay', () => {
    expect(resolveTrack([man('men'), man('men')])).toBe('gay');
    expect(resolveTrack([man('men'), man('both')])).toBe('gay');
    expect(resolveTrack([man('both'), man('both')])).toBe('gay');
  });

  it('two men where one prefers women only -> no deck', () => {
    expect(resolveTrack([man('men'), man('women')])).toBeNull();
  });

  it('man and woman each preferring the other or both -> straight', () => {
    expect(resolveTrack([man('women'), woman('men')])).toBe('straight');
    expect(resolveTrack([man('both'), woman('both')])).toBe('straight');
    expect(resolveTrack([woman('men'), man('both')])).toBe('straight');
  });

  it('man and woman where one is not interested -> no deck', () => {
    expect(resolveTrack([man('men'), woman('men')])).toBeNull();
    expect(resolveTrack([man('women'), woman('women')])).toBeNull();
  });

  it('two women -> no deck in v1 (no lesbian cards)', () => {
    expect(resolveTrack([woman('women'), woman('women')])).toBeNull();
  });

  it('3+ men all preferring men or both -> gay', () => {
    expect(resolveTrack([man('men'), man('both'), man('men'), man('both')])).toBe('gay');
  });

  it('3+ mixed (MMF / MFF) -> straight', () => {
    expect(resolveTrack([man('both'), man('women'), woman('men')])).toBe('straight');
    expect(resolveTrack([man('women'), woman('both'), woman('men')])).toBe('straight');
  });

  it('3+ mixed where someone fits neither -> no deck', () => {
    expect(resolveTrack([man('men'), man('women'), woman('men')])).toBeNull();
  });

  it('non-binary players are matched by stated preference', () => {
    expect(resolveTrack([nb('men'), man('both')])).toBe('gay');
    expect(resolveTrack([nb('women'), woman('both')])).toBe('straight');
    expect(resolveTrack([nb('both'), nb('both')])).toBe('gay');
  });

  it('a new track only needs a rule (lesbian example)', () => {
    const lesbian: TrackRule = {
      track: 'lesbian',
      label: 'Lesbian',
      matches: (ps) => ps.every((p) => p.gender === 'woman' && attractedTo(p.preference, 'woman')),
    };
    const rules = [...TRACK_RULES, lesbian];
    expect(resolveTrack([woman('women'), woman('both')], rules)).toBe('lesbian');
    expect(resolveTrack([man('women'), woman('men')], rules)).toBe('straight');
  });
});
