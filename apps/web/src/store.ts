import { create } from 'zustand';
import { DEFAULT_SETTINGS, type MeResponse, type RoomSnapshot, type Settings } from '@nc/shared';
import { api, ApiError } from './lib/api';

export type Conn =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'offline'
  | 'superseded'
  | 'expired'
  | 'kicked'
  | 'closed'
  | 'notMember';

interface AppState {
  me: MeResponse | null;
  meLoaded: boolean;
  room: RoomSnapshot | null;
  /** serverNow - Date.now(), for timer rendering. */
  clockOffset: number;
  conn: Conn;
  decoy: boolean;
  toast: string | null;
  loadMe(): Promise<MeResponse | null>;
  setMe(me: MeResponse | null): void;
  patchSettings(s: Partial<Settings>): Promise<void>;
  setRoom(room: RoomSnapshot | null): void;
  setConn(c: Conn): void;
  setDecoy(on: boolean): void;
  showToast(msg: string | null): void;
}

export const useApp = create<AppState>((set, get) => ({
  me: null,
  meLoaded: false,
  room: null,
  clockOffset: 0,
  conn: 'idle',
  decoy: false,
  toast: null,
  async loadMe() {
    try {
      const me = await api.me();
      set({ me, meLoaded: true });
      return me;
    } catch (e) {
      if (!(e instanceof ApiError)) set({ meLoaded: true });
      else set({ me: null, meLoaded: true });
      return null;
    }
  },
  setMe(me) {
    set({ me, meLoaded: true });
  },
  async patchSettings(s) {
    const me = get().me;
    if (!me) return;
    // optimistic
    set({ me: { ...me, profile: { ...me.profile, settings: { ...me.profile.settings, ...s } } } });
    try {
      set({ me: await api.patchMe({ settings: s }) });
    } catch {
      /* keep optimistic value */
    }
  },
  setRoom(room) {
    set(room ? { room, clockOffset: room.serverNow - Date.now() } : { room: null });
  },
  setConn(conn) {
    set({ conn });
  },
  setDecoy(decoy) {
    set({ decoy });
  },
  showToast(toast) {
    set({ toast });
  },
}));

export function useSettings(): Settings {
  return useApp((s) => s.me?.profile.settings ?? DEFAULT_SETTINGS);
}
