// Validates data/cards.json exactly as the server does at startup, plus authoring checks:
// Appendix A counts, leftover TODO/PLACEHOLDER text, and timed text without durationSeconds.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadCards } from '../apps/server/src/cards';
import { DATA_DIR } from '../apps/server/src/paths';

const EXPECTED: Record<string, number> = {
  anal: 6, oral: 8, erotic: 6, threesome: 10, group: 10, master_slave: 10,
};

const file = process.argv[2] ?? path.join(DATA_DIR, 'cards.json');
if (!existsSync(file)) {
  console.error(`Not found: ${file}`);
  process.exit(1);
}

let store;
try {
  store = loadCards(file);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const problems: string[] = [];
const warnings: string[] = [];
for (const track of ['gay', 'straight']) {
  for (const [genre, n] of Object.entries(EXPECTED)) {
    const got = store.all.filter((c) => c.track === track && c.genre === genre).length;
    if (got !== n) warnings.push(`${track}/${genre}: ${got} cards (Appendix A expects ${n})`);
  }
}
for (const c of store.all) {
  if (/TODO|PLACEHOLDER/i.test(c.title + c.text)) problems.push(`${c.id}: still has TODO/PLACEHOLDER text`);
  if (/\b\d+\s*(sec|second|min|minute)/i.test(c.text) && !c.durationSeconds) {
    warnings.push(`${c.id}: text names a time but has no durationSeconds`);
  }
  for (const r of c.roles) {
    if (!c.text.includes(`{${r}}`)) warnings.push(`${c.id}: role {${r}} is listed but not used in text`);
  }
}

console.log(`${store.all.length} cards valid against the schema (${path.basename(file)})`);
warnings.forEach((w) => console.log(`warn: ${w}`));
problems.forEach((p) => console.error(`todo: ${p}`));
if (problems.length) {
  console.error(`${problems.length} card(s) still need text`);
  process.exit(1);
}
