import { Link } from 'react-router-dom';
import { t, tList } from '../i18n';
import { Shell } from '../components/chrome';
import { Panel } from '../components/ui';

export function Info({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <Shell>
      <Link to="/" className="py-3 text-sm text-mist hover:text-blush">
        ← {t('common.home')}
      </Link>
      <Panel className="mt-2">
        <h1 className="mb-4 font-display text-3xl text-rose">{t(`${kind}.title`)}</h1>
        <div className="space-y-3 text-sm leading-relaxed text-blush/90">
          {tList(`${kind}.body`).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </Panel>
    </Shell>
  );
}
