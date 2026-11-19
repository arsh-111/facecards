import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import { hmac, newToken, type SessionRow } from './sessions';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionRow | null;
  }
}

/** Section 7.4: every route revealing card content (or any profile data) calls this. */
export function requireVerifiedSession(req: FastifyRequest): SessionRow {
  const s = req.session;
  if (!s) throw new HttpError(401, 'NO_SESSION');
  if (!s.ageVerified) throw new HttpError(403, 'AGE_NOT_VERIFIED');
  return s;
}

export function cookieNames(cfg: Config) {
  return {
    session: cfg.sessionCookie,
    client: cfg.isProd ? '__Host-nc_client' : 'nc_client',
    block: cfg.isProd ? '__Host-nc_block' : 'nc_block',
  };
}

export function baseCookie(cfg: Config) {
  return { httpOnly: true, secure: cfg.isProd, sameSite: 'lax' as const, path: '/' };
}

/**
 * Rate-limit identity: an opaque random cookie, HMAC'd with SESSION_HASH_SECRET before storage.
 * Never an IP address (Hard Rules).
 */
export function clientKey(req: FastifyRequest, reply: FastifyReply, cfg: Config): string {
  const names = cookieNames(cfg);
  let token = req.cookies[names.client];
  if (!token || token.length > 64) {
    token = newToken();
    reply.setCookie(names.client, token, { ...baseCookie(cfg), maxAge: 30 * 24 * 3600 });
  }
  return hmac(cfg.hashSecret, token);
}

export function setSessionCookie(reply: FastifyReply, cfg: Config, token: string): void {
  reply.setCookie(cfg.sessionCookie, token, {
    ...baseCookie(cfg),
    maxAge: Math.floor(cfg.absoluteMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.sessionCookie, baseCookie(cfg));
}

export function setBlockCookie(reply: FastifyReply, cfg: Config): void {
  reply.setCookie(cookieNames(cfg).block, '1', { ...baseCookie(cfg), maxAge: 24 * 3600 });
}
