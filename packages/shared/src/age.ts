import { type AgeBand, MIN_AGE } from './constants';

/** Only the band is stored, never the exact age (Section 6.1). */
export function ageBand(age: number): AgeBand {
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  return '45+';
}

/** Whole years between an ISO date (YYYY-MM-DD) and `now` (UTC). Null for invalid/future dates. */
export function ageFromDob(dob: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  if (date.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isAdult(age: number): boolean {
  return Number.isFinite(age) && age >= MIN_AGE;
}
