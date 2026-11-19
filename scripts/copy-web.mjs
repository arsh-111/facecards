// Copies the built web app into the server's static directory (PRD 12.3).
import { cpSync, rmSync, existsSync } from 'node:fs';
const src = new URL('../apps/web/dist/', import.meta.url);
const dest = new URL('../apps/server/dist/public/', import.meta.url);
if (!existsSync(src)) throw new Error('apps/web/dist missing; build the web app first');
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('copied web build -> apps/server/dist/public');
