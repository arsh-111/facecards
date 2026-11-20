// Generates data/cards.template.json: the 100-card skeleton from PRD Appendix A with correct
// ids, roles, minPlayers and a TODO text per card. Copy it to data/cards.json and write the text.
import { existsSync, writeFileSync } from 'node:fs';

const TAXONOMY = {
  anal: { count: 6, minPlayers: 2, roles: ['top', 'bottom'] },
  oral: { count: 8, minPlayers: 2, roles: ['giver', 'receiver'] },
  erotic: { count: 6, minPlayers: 2, roles: ['giver', 'receiver'] },
  threesome: { count: 10, minPlayers: 3, roles: ['A', 'B', 'C'] },
  group: { count: 10, minPlayers: 4, roles: ['A', 'B', 'C'] },
  master_slave: { count: 10, minPlayers: 2, roles: ['master', 'slave'] },
};
const INTENSITY = ['warm', 'warm', 'hot', 'hot', 'intense'];

const cards = [];
for (const track of ['gay', 'straight']) {
  for (const [genre, g] of Object.entries(TAXONOMY)) {
    for (let n = 1; n <= g.count; n++) {
      const who = g.roles.map((r) => `{${r}}`).join(', ');
      cards.push({
        id: `${track}-${genre}-${String(n).padStart(2, '0')}`,
        track,
        genre,
        title: `TODO title ${n}`,
        text: `TODO: position, who does what (${who}), duration, and any restriction.`,
        roles: g.roles,
        minPlayers: g.minPlayers,
        durationSeconds: 120,
        intensity: INTENSITY[(n - 1) % INTENSITY.length],
        tags: [],
      });
    }
  }
}

const out = new URL('../data/cards.template.json', import.meta.url);
writeFileSync(out, JSON.stringify({ version: 1, cards }, null, 2) + '\n');
console.log(`wrote ${cards.length} cards to data/cards.template.json`);
if (!existsSync(new URL('../data/cards.json', import.meta.url))) {
  console.log('next: copy it to data/cards.json, write each title/text, then run npm run cards:check');
}
