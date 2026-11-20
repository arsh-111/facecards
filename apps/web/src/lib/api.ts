import type { MeResponse, ProfilePatch, RoomAction, RoomSnapshot } from '@nc/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-NC-Client': '1', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network failure: offline, or the server is not running.
    throw new ApiError(0, 'UNREACHABLE');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    // Our server always answers errors with JSON `{ error }`. A non-JSON 5xx comes from a proxy
    // or gateway in front of it (dev proxy, load balancer), meaning the app server is unreachable.
    if (!data?.error && res.status >= 500) throw new ApiError(res.status, 'UNREACHABLE');
    throw new ApiError(res.status, data?.error ?? 'SERVER_ERROR');
  }
  if (data === null) throw new ApiError(res.status, 'SERVER_ERROR');
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
  /** Make this tab the active one in the room and get the first snapshot. */
  connect: (code: string, tabId: string) =>
    request<RoomSnapshot>('POST', `/api/rooms/${code}/connect`, { tabId }),
  /** Poll the authoritative room state. */
  room: (code: string, tabId: string) =>
    request<RoomSnapshot>('GET', `/api/rooms/${code}`, undefined, { 'X-NC-Tab': tabId }),
  action: (code: string, tabId: string, event: RoomAction, payload: Record<string, unknown>) =>
    request<{ snapshot: RoomSnapshot | null }>(
      'POST',
      `/api/rooms/${code}/actions`,
      { event, payload },
      { 'X-NC-Tab': tabId },
    ),
  leaveRoom: (code: string) => request<{ ok: boolean }>('POST', `/api/rooms/${code}/leave`),
};
