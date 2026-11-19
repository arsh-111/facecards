import en from './en.json';

type Dict = { [k: string]: string | string[] | Dict };
const resources: Record<string, Dict> = { en: en as Dict };
let lang = 'en';

export function setLanguage(l: string): void {
  if (resources[l]) lang = l;
}

function lookup(key: string): string | string[] | Dict | undefined {
  let cur: string | string[] | Dict | undefined = resources[lang];
  for (const part of key.split('.')) {
    if (!cur || typeof cur === 'string' || Array.isArray(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Translate a key with `{var}` interpolation. Falls back to the key itself. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const v = lookup(key);
  if (typeof v !== 'string') return key;
  return v.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function tList(key: string): string[] {
  const v = lookup(key);
  return Array.isArray(v) ? v : [];
}
