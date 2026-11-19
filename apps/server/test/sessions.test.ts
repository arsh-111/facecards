import { describe, expect, it } from 'vitest';
import { hashToken, newToken, sessionExpiryState, shouldTouch } from '../src/sessions';

const HOUR = 3600_000;
const cfg = { idleMs: 3 * HOUR, absoluteMs: 24 * HOUR };
const t0 = Date.UTC(2026, 0, 1);
const row = (createdOff: number, seenOff: number) => ({
  createdAt: new Date(t0 + createdOff),
  lastSeenAt: new Date(t0 + seenOff),
  expiresAt: new Date(t0 + createdOff + cfg.absoluteMs),
});

describe('session lifetimes (Section 7.3)', () => {
  it('is ok while active', () => {
    expect(sessionExpiryState(row(0, 0), t0 + HOUR, cfg)).toBe('ok');
  });
  it('expires after 3 hours idle', () => {
    expect(sessionExpiryState(row(0, 0), t0 + 3 * HOUR - 1, cfg)).toBe('ok');
    expect(sessionExpiryState(row(0, 0), t0 + 3 * HOUR, cfg)).toBe('idle');
  });
  it('expires 24 hours after creation even when active', () => {
    expect(sessionExpiryState(row(0, 23.9 * HOUR), t0 + 24 * HOUR, cfg)).toBe('absolute');
  });
  it('touches last_seen at most once per minute', () => {
    expect(shouldTouch(row(0, 0), t0 + 59_000)).toBe(false);
    expect(shouldTouch(row(0, 0), t0 + 60_000)).toBe(true);
  });
  it('tokens are 256-bit base64url and only the SHA-256 is stored', () => {
    const t = newToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});
