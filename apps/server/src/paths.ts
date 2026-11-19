import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file (src/ in dev, dist/ when bundled) to the repo root holding /drizzle. */
function findRepoRoot(): string {
  const candidates = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      if (existsSync(path.join(dir, 'drizzle')) && existsSync(path.join(dir, 'data'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'drizzle');
export const DATA_DIR = path.join(REPO_ROOT, 'data');
/** Built web app copied by scripts/copy-web.mjs. */
export const PUBLIC_DIR = path.join(REPO_ROOT, 'apps', 'server', 'dist', 'public');
