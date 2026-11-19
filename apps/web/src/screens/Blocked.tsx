import { t } from '../i18n';
import { Shell } from '../components/chrome';

/** FR-2 exit screen for under-18 attempts. */
export function Blocked() {
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <h1 className="font-display text-3xl text-rose">{t('blocked.title')}</h1>
        <p className="max-w-xs text-mist">{t('blocked.body')}</p>
        <a
          href="https://duckduckgo.com"
          rel="noreferrer noopener"
          className="glass min-h-12 rounded-2xl px-6 py-3 text-blush"
        >
          {t('blocked.exit')}
        </a>
      </div>
    </Shell>
  );
}
