import { z } from 'zod';
import {
  GENDERS,
  GENRES,
  INTENSITIES,
  PREFERENCES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_MODES,
  TIMER_MODES,
  TURN_MODES,
} from './constants';
import { RolePrefsSchema } from './roles';

export const GenreSchema = z.enum(GENRES);
export const GenderSchema = z.enum(GENDERS);
export const PreferenceSchema = z.enum(PREFERENCES);
export const IntensitySchema = z.enum(INTENSITIES);

/* ------------------------------------------------------------------ cards */

export const CardSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-[a-z_]+-\d{2,}$/, 'id must be <track>-<genre>-<nn>'),
    track: z.string().regex(/^[a-z]+$/),
    genre: GenreSchema,
    title: z.string().min(1).max(80),
    text: z.string().min(1).max(2000),
    roles: z.array(z.string().regex(/^[A-Za-z_]+$/)).max(8),
    minPlayers: z.number().int().min(2).max(8),
    durationSeconds: z.number().int().positive().max(3600).optional(),
    intensity: IntensitySchema.optional(),
    tags: z.array(z.string()).optional(),
  })
  .superRefine((c, ctx) => {
    if (!c.id.startsWith(`${c.track}-${c.genre}-`)) {
      ctx.addIssue({ code: 'custom', message: `id ${c.id} must start with ${c.track}-${c.genre}-` });
    }
    if (new Set(c.roles).size !== c.roles.length) {
      ctx.addIssue({ code: 'custom', message: `card ${c.id} has duplicate roles` });
    }
    for (const m of c.text.matchAll(/\{([A-Za-z_]+)\}/g)) {
      if (!c.roles.includes(m[1] as string)) {
        ctx.addIssue({ code: 'custom', message: `card ${c.id} uses {${m[1]}} not listed in roles` });
      }
    }
  });
export type Card = z.infer<typeof CardSchema>;

export const CardsFileSchema = z
  .object({ version: z.literal(1), cards: z.array(CardSchema).min(1) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const c of f.cards) {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate card id ${c.id}` });
      seen.add(c.id);
    }
  });
export type CardsFile = z.infer<typeof CardsFileSchema>;

/* -------------------------------------------------------------- profile */

export const DisplayNameSchema = z
  .string()
  .trim()
  // \p{M} (combining marks) is required for scripts such as Devanagari: "प्रिया" uses vowel signs.
  .regex(/^[\p{L}\p{M}\p{N} _.'-]{2,20}$/u, 'Nickname must be 2-20 letters, numbers or spaces')
  .refine((s) => /\p{L}/u.test(s), 'Nickname must contain a letter');

export const SettingsSchema = z.object({
  sound: z.boolean(),
  ambient: z.boolean(),
  haptics: z.boolean(),
  animation: z.enum(['full', 'reduced']),
  language: z.enum(['en']),
  themeIntensity: z.enum(['subtle', 'normal', 'rich']),
  seenNote: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  sound: false,
  ambient: false,
  haptics: true,
  animation: 'full',
  language: 'en',
  themeIntensity: 'normal',
  seenNote: false,
};

export const BoundariesSchema = z.object({
  neverGenres: z.array(GenreSchema).max(GENRES.length),
  neverCardIds: z.array(z.string().max(64)).max(200),
});
export type Boundaries = z.infer<typeof BoundariesSchema>;
export const DEFAULT_BOUNDARIES: Boundaries = { neverGenres: [], neverCardIds: [] };

const AgeSchema = z.number().int().min(0).max(130);
const DobSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RegisterSchema = z
  .object({
    age: AgeSchema.optional(),
    dob: DobSchema.optional(),
    gender: GenderSchema,
    preference: PreferenceSchema,
    genres: z.array(GenreSchema).min(1).max(GENRES.length),
    displayName: DisplayNameSchema.optional().or(z.literal('').transform(() => undefined)),
  })
  .strict()
  .refine((b) => (b.age === undefined) !== (b.dob === undefined), {
    message: 'Provide exactly one of age or dob',
  });
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const ProfilePatchSchema = z
  .object({
    age: AgeSchema.optional(),
    gender: GenderSchema.optional(),
    preference: PreferenceSchema.optional(),
    genres: z.array(GenreSchema).min(1).max(GENRES.length).optional(),
    displayName: DisplayNameSchema.nullable().optional(),
    settings: SettingsSchema.partial().optional(),
    boundaries: BoundariesSchema.partial().optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export interface Profile {
  gender: z.infer<typeof GenderSchema>;
  preference: z.infer<typeof PreferenceSchema>;
  genres: z.infer<typeof GenreSchema>[];
  displayName: string | null;
  ageBand: string;
  settings: Settings;
  boundaries: Boundaries;
}

export interface MeResponse {
  profile: Profile;
  currentRoom: string | null;
  neverCards: { id: string; title: string }[];
  expiresAt: string;
}

/* ---------------------------------------------------------------- rooms */

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .refine((s) => [...s].every((ch) => ROOM_CODE_ALPHABET.includes(ch)), 'Invalid room code');

export const CreateRoomSchema = z
  .object({ mode: z.enum(ROOM_MODES), solo: z.boolean().optional() })
  .strict();
export const JoinRoomSchema = z.object({ code: RoomCodeSchema }).strict();

/* -------------------------------------------------------- room actions */

const ActionId = z.string().min(8).max(64);
const base = { actionId: ActionId };
const PlayerId = z.string().uuid();

export const LocalPlayerSchema = z.object({
  name: DisplayNameSchema,
  gender: GenderSchema,
  preference: PreferenceSchema,
});

/** Every room mutation. Sent as POST /api/rooms/:code/actions { event, payload }. */
export const ActionSchemas = {
  'room:setGenres': z.object({ ...base, genres: z.array(GenreSchema).max(GENRES.length) }),
  'room:setOptions': z.object({
    ...base,
    intensity: IntensitySchema.nullable().optional(),
    turnMode: z.enum(TURN_MODES).optional(),
    timerMode: z.enum(TIMER_MODES).optional(),
    pauseOnAway: z.boolean().optional(),
  }),
  'room:setRolePrefs': z.object({ ...base, playerId: PlayerId, rolePrefs: RolePrefsSchema }),
  'room:proposeTrack': z.object({ ...base, track: z.string().max(32) }),
  'room:confirmTrack': z.object({ ...base }),
  'room:addLocal': z.object({ ...base, player: LocalPlayerSchema }),
  'room:updateLocal': z.object({ ...base, playerId: PlayerId, player: LocalPlayerSchema }),
  'room:removeLocal': z.object({ ...base, playerId: PlayerId }),
  'room:start': z.object({ ...base }),
  'room:playAgain': z.object({ ...base }),
  'room:leave': z.object({ ...base }),
  'card:draw': z.object({ ...base }),
  'card:swap': z.object({ ...base }),
  'card:startTimer': z.object({ ...base }),
  'card:done': z.object({ ...base }),
  'card:skip': z.object({ ...base }),
  'card:never': z.object({ ...base }),
  'deck:reshuffle': z.object({ ...base }),
  'roles:swap': z.object({ ...base }),
  'roles:confirm': z.object({ ...base, assignment: z.record(z.string(), PlayerId).optional() }),
  'turn:set': z.object({ ...base, playerId: PlayerId }),
  'game:pause': z.object({ ...base }),
  'game:resume': z.object({ ...base }),
  'game:stop': z.object({ ...base }),
  'game:end': z.object({ ...base }),
  'host:kick': z.object({ ...base, playerId: PlayerId }),
} as const;

export type RoomAction = keyof typeof ActionSchemas;
export type ActionPayload<E extends RoomAction> = z.infer<(typeof ActionSchemas)[E]>;
export const ROOM_ACTIONS = Object.keys(ActionSchemas) as RoomAction[];

export const ActionRequestSchema = z
  .object({
    event: z.enum(ROOM_ACTIONS as [RoomAction, ...RoomAction[]]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

/** A browser tab id; the most recently connected tab is the active one for that player. */
export const TabIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const ConnectSchema = z.object({ tabId: TabIdSchema }).strict();
