import type { MeResponse, ProfilePatch, RoomSnapshot } from '@nc/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-NC-Client': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'SERVER_ERROR');
  return data as T;
}

export interface RegisterBody {
  age?: number;
  dob?: string;
  gender: string;
  preference: string;
  genres: string[];
  displayName?: string;
}

export const api = {
  register: (b: RegisterBody) => request<MeResponse>('POST', '/api/register', b),
  me: () => request<MeResponse>('GET', '/api/me'),
  patchMe: (p: ProfilePatch) => request<MeResponse>('PATCH', '/api/me', p),
  deleteMe: () => request<void>('DELETE', '/api/me'),
  createRoom: (mode: 'online' | 'pass_and_play', solo = false) =>
    request<{ code: string; mode: string }>('POST', '/api/rooms', { mode, solo }),
  joinRoom: (code: string) => request<{ code: string }>('POST', '/api/rooms/join', { code }),
  room: (code: string) => request<RoomSnapshot>('GET', `/api/rooms/${code}`),
  leaveRoom: (code: string) => request<{ ok: boolean }>('POST', `/api/rooms/${code}/leave`),
};
