import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CardsFileSchema, knownTracks, type Card } from '@nc/shared';
import { DATA_DIR } from './paths';

export interface CardStore {
  source: string;
  all: Card[];
  byId: Map<string, Card>;
}

/**
 * Loads data/cards.json (owner-supplied) or falls back to data/cards.sample.json. Validated with
 * Zod at startup; an invalid file throws so the server fails fast (Section 6.2).
 */
export function loadCards(explicitPath: string | null = null): CardStore {
  const file =
    explicitPath ??
    [path.join(DATA_DIR, 'cards.json'), path.join(DATA_DIR, 'cards.sample.json')].find((p) =>
      existsSync(p),
    );
  if (!file) throw new Error('No card file found: add data/cards.json or data/cards.sample.json');

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Card file ${path.basename(file)} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = CardsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Card file ${path.basename(file)} failed validation:\n${issues}`);
  }
  const tracks = knownTracks();
  const unknown = parsed.data.cards.filter((c) => !tracks.includes(c.track));
  if (unknown.length) {
    throw new Error(
      `Card file uses track(s) without a resolution rule: ${[...new Set(unknown.map((c) => c.track))].join(', ')}. ` +
        'Add them to TRACK_RULES in packages/shared/src/tracks.ts.',
    );
  }
  return {
    source: path.basename(file),
    all: parsed.data.cards,
    byId: new Map(parsed.data.cards.map((c) => [c.id, c])),
  };
}
