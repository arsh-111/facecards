// Generates data/cards.sample.json: 2 neutral placeholder cards per track/genre (PRD Section 0.4).
import { writeFileSync } from 'node:fs';
const genres = {
  erotic: { roles: ['giver', 'receiver'], min: 2 },
  oral: { roles: ['giver', 'receiver'], min: 2 },
  anal: { roles: ['top', 'bottom'], min: 2 },
  threesome: { roles: ['A', 'B', 'C'], min: 3 },
  group: { roles: ['A', 'B', 'C'], min: 4 },
  master_slave: { roles: ['master', 'slave'], min: 2 },
};
const cards = [];
for (const track of ['gay', 'straight']) {
  for (const [genre, g] of Object.entries(genres)) {
    for (const n of [1, 2]) {
      const who = g.roles.map((r) => `{${r}}`).join(', ');
      const card = {
        id: `${track}-${genre}-0${n}`,
        track,
        genre,
        title: `Placeholder ${genre.replace('_', ' ')} ${n}`,
        text: `PLACEHOLDER: describe task. Players: ${who}.`,
        roles: g.roles,
        minPlayers: g.min,
        intensity: n === 1 ? 'warm' : 'hot',
        tags: ['placeholder'],
      };
      if (n === 1) card.durationSeconds = 60;
      cards.push(card);
    }
  }
}
writeFileSync(new URL('../data/cards.sample.json', import.meta.url), JSON.stringify({ version: 1, cards }, null, 2) + '\n');
console.log(`wrote ${cards.length} cards`);
