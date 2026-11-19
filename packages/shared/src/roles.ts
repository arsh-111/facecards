import { z } from 'zod';

export const RolePrefsSchema = z.object({
  topBottom: z.enum(['top', 'bottom', 'versatile']),
  giverReceiver: z.enum(['giver', 'receiver', 'both']),
  masterSlave: z.enum(['master', 'slave', 'switch']),
});
export type RolePrefs = z.infer<typeof RolePrefsSchema>;

export const DEFAULT_ROLE_PREFS: RolePrefs = {
  topBottom: 'versatile',
  giverReceiver: 'both',
  masterSlave: 'switch',
};

const PAIRS: Record<string, { key: keyof RolePrefs; same: string; flex: string; opposite: string }> = {
  top: { key: 'topBottom', same: 'top', flex: 'versatile', opposite: 'bottom' },
  bottom: { key: 'topBottom', same: 'bottom', flex: 'versatile', opposite: 'top' },
  giver: { key: 'giverReceiver', same: 'giver', flex: 'both', opposite: 'receiver' },
  receiver: { key: 'giverReceiver', same: 'receiver', flex: 'both', opposite: 'giver' },
  master: { key: 'masterSlave', same: 'master', flex: 'switch', opposite: 'slave' },
  slave: { key: 'masterSlave', same: 'slave', flex: 'switch', opposite: 'master' },
};

/** 2 = exact comfort match, 1 = flexible, -10 = against stated comfort, 0 = neutral role (A/B/C). */
export function roleComfort(role: string, prefs: RolePrefs): number {
  const p = PAIRS[role];
  if (!p) return 0;
  const v = prefs[p.key];
  if (v === p.same) return 2;
  if (v === p.flex) return 1;
  return -10;
}

export interface RolePlayer {
  id: string;
  rolePrefs: RolePrefs;
}

export type RoleAssignment = Record<string, string>; // role -> playerId

export interface AssignOptions {
  /** The player whose turn it is; preferred to be part of the card. */
  activePlayerId?: string | null;
  rng: () => number;
}

/**
 * FR-10/FR-11: assign distinct players to the card's roles honoring role comfort. Returns null
 * when the card needs more players than are present.
 */
export function assignRoles(
  roles: readonly string[],
  players: readonly RolePlayer[],
  opts: AssignOptions,
): RoleAssignment | null {
  if (roles.length === 0) return {};
  if (roles.length > players.length) return null;
  let best: { score: number; pick: RolePlayer[] } | null = null;
  const used = new Set<number>();
  const pick: RolePlayer[] = [];

  const visit = (depth: number): void => {
    if (depth === roles.length) {
      let score = 0;
      pick.forEach((p, i) => (score += roleComfort(roles[i] as string, p.rolePrefs)));
      if (opts.activePlayerId && pick.some((p) => p.id === opts.activePlayerId)) score += 3;
      score += opts.rng() * 0.9; // random tie-break
      if (!best || score > best.score) best = { score, pick: pick.slice() };
      return;
    }
    for (let i = 0; i < players.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      pick.push(players[i] as RolePlayer);
      visit(depth + 1);
      pick.pop();
      used.delete(i);
    }
  };
  visit(0);
  const result: RoleAssignment = {};
  (best as { pick: RolePlayer[] } | null)?.pick.forEach((p, i) => (result[roles[i] as string] = p.id));
  return result;
}

/** Rotate the assigned players one step through the roles (the "Swap roles" action). */
export function rotateAssignment(roles: readonly string[], assignment: RoleAssignment): RoleAssignment {
  if (roles.length < 2) return { ...assignment };
  const ids = roles.map((r) => assignment[r] as string);
  const rotated = [ids[ids.length - 1] as string, ...ids.slice(0, -1)];
  const out: RoleAssignment = {};
  roles.forEach((r, i) => (out[r] = rotated[i] as string));
  return out;
}

export function isValidAssignment(
  roles: readonly string[],
  assignment: RoleAssignment,
  playerIds: readonly string[],
): boolean {
  const ids = roles.map((r) => assignment[r]);
  if (ids.some((id) => !id || !playerIds.includes(id))) return false;
  return new Set(ids).size === ids.length && Object.keys(assignment).length === roles.length;
}

/** FR-12: replace {role} placeholders with display names. Unknown placeholders are left as-is. */
export function renderCardText(
  text: string,
  assignment: RoleAssignment,
  names: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{([A-Za-z_]+)\}/g, (whole, role: string) => {
    const pid = assignment[role];
    if (!pid) return whole;
    return names[pid] ?? whole;
  });
}
