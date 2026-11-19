import { describe, expect, it } from 'vitest';
import {
  assignRoles,
  DEFAULT_ROLE_PREFS,
  isValidAssignment,
  renderCardText,
  rotateAssignment,
  type RolePrefs,
} from '../src/roles';

const rng = () => 0.5;
const p = (id: string, over: Partial<RolePrefs> = {}) => ({
  id,
  rolePrefs: { ...DEFAULT_ROLE_PREFS, ...over },
});

describe('assignRoles (FR-10, FR-11)', () => {
  it('honors top/bottom comfort', () => {
    const a = assignRoles(['top', 'bottom'], [p('x', { topBottom: 'bottom' }), p('y', { topBottom: 'top' })], { rng });
    expect(a).toEqual({ top: 'y', bottom: 'x' });
  });

  it('honors giver/receiver and master/slave comfort', () => {
    expect(
      assignRoles(['giver', 'receiver'], [p('x', { giverReceiver: 'receiver' }), p('y')], { rng }),
    ).toEqual({ giver: 'y', receiver: 'x' });
    expect(
      assignRoles(['master', 'slave'], [p('x', { masterSlave: 'master' }), p('y', { masterSlave: 'slave' })], { rng }),
    ).toEqual({ master: 'x', slave: 'y' });
  });

  it('prefers including the active player', () => {
    const a = assignRoles(['A', 'B'], [p('x'), p('y'), p('z')], { rng, activePlayerId: 'z' });
    expect(Object.values(a ?? {})).toContain('z');
  });

  it('returns null when the card needs more players than present (FR-8)', () => {
    expect(assignRoles(['A', 'B', 'C'], [p('x'), p('y')], { rng })).toBeNull();
  });

  it('still assigns when nobody is comfortable, so players can swap', () => {
    const a = assignRoles(['top', 'bottom'], [p('x', { topBottom: 'top' }), p('y', { topBottom: 'top' })], { rng });
    expect(a && isValidAssignment(['top', 'bottom'], a, ['x', 'y'])).toBe(true);
  });
});

describe('rotate / validate / render', () => {
  it('rotates roles', () => {
    expect(rotateAssignment(['top', 'bottom'], { top: 'x', bottom: 'y' })).toEqual({ top: 'y', bottom: 'x' });
  });
  it('validates assignments', () => {
    expect(isValidAssignment(['A', 'B'], { A: 'x', B: 'x' }, ['x', 'y'])).toBe(false);
    expect(isValidAssignment(['A', 'B'], { A: 'x', B: 'q' }, ['x', 'y'])).toBe(false);
    expect(isValidAssignment(['A', 'B'], { A: 'x', B: 'y' }, ['x', 'y'])).toBe(true);
  });
  it('replaces placeholders with names (FR-12)', () => {
    expect(
      renderCardText('{giver} with {receiver}; {other}', { giver: 'x', receiver: 'y' }, { x: 'Sam', y: 'Ari' }),
    ).toBe('Sam with Ari; {other}');
  });
});
