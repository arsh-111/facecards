import { GENDERS, GENRES, PREFERENCES, type Genre, type RolePrefs } from '@nc/shared';
import { t } from '../i18n';
import { api } from '../lib/api';
import { useApp } from '../store';
import { Chip, Segmented } from './ui';

export function GenderPicker({ value, onChange }: { value: string; onChange(v: (typeof GENDERS)[number]): void }) {
  return (
    <div role="radiogroup" aria-label={t('settings.gender')} className="flex flex-wrap gap-2">
      {GENDERS.map((g) => (
        <Chip key={g} role="radio" selected={value === g} onToggle={() => onChange(g)}>
          {t(`gender.${g}`)}
        </Chip>
      ))}
    </div>
  );
}

export function PreferencePicker({
  value,
  onChange,
}: {
  value: string;
  onChange(v: (typeof PREFERENCES)[number]): void;
}) {
  return (
    <div role="radiogroup" aria-label={t('settings.preference')} className="flex flex-wrap gap-2">
      {PREFERENCES.map((p) => (
        <Chip key={p} role="radio" selected={value === p} onToggle={() => onChange(p)}>
          {t(`preference.${p}`)}
        </Chip>
      ))}
    </div>
  );
}

export function GenrePicker({
  value,
  onChange,
  options = GENRES,
  disabled,
}: {
  value: readonly Genre[];
  onChange(v: Genre[]): void;
  options?: readonly Genre[];
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={t('settings.genres')} className="flex flex-wrap gap-2">
      {options.map((g) => (
        <Chip
          key={g}
          selected={value.includes(g)}
          disabled={disabled}
          onToggle={() => onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g])}
        >
          {t(`genre.${g}`)}
        </Chip>
      ))}
    </div>
  );
}

export function RolePrefsEditor({
  value,
  onChange,
  title,
}: {
  value: RolePrefs;
  onChange(v: RolePrefs): void;
  title: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm text-mist">{title}</legend>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-mist">{t('lobby.topBottom.label')}</p>
        <Segmented
          label={t('lobby.topBottom.label')}
          value={value.topBottom}
          onChange={(v) => onChange({ ...value, topBottom: v })}
          options={(['top', 'bottom', 'versatile'] as const).map((v) => ({ value: v, label: t(`lobby.topBottom.${v}`) }))}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-mist">{t('lobby.giverReceiver.label')}</p>
        <Segmented
          label={t('lobby.giverReceiver.label')}
          value={value.giverReceiver}
          onChange={(v) => onChange({ ...value, giverReceiver: v })}
          options={(['giver', 'receiver', 'both'] as const).map((v) => ({ value: v, label: t(`lobby.giverReceiver.${v}`) }))}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-mist">{t('lobby.masterSlave.label')}</p>
        <Segmented
          label={t('lobby.masterSlave.label')}
          value={value.masterSlave}
          onChange={(v) => onChange({ ...value, masterSlave: v })}
          options={(['master', 'slave', 'switch'] as const).map((v) => ({ value: v, label: t(`lobby.masterSlave.${v}`) }))}
        />
      </div>
    </fieldset>
  );
}

/** FR-27 Boundaries: never-genres and never-cards for the current player. */
export function BoundariesEditor() {
  const me = useApp((s) => s.me);
  const setMe = useApp((s) => s.setMe);
  if (!me) return null;
  const b = me.profile.boundaries;
  const save = async (patch: Partial<typeof b>) => {
    setMe({ ...me, profile: { ...me.profile, boundaries: { ...b, ...patch } } });
    setMe(await api.patchMe({ boundaries: patch }));
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-mist">{t('boundaries.body')}</p>
      <div>
        <p className="mb-2 text-sm text-mist">{t('boundaries.neverGenres')}</p>
        <div role="group" aria-label={t('boundaries.neverGenres')} className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <Chip
              key={g}
              selected={b.neverGenres.includes(g)}
              onToggle={() =>
                void save({
                  neverGenres: b.neverGenres.includes(g) ? b.neverGenres.filter((x) => x !== g) : [...b.neverGenres, g],
                })
              }
            >
              {t('boundaries.never')}: {t(`genre.${g}`)}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm text-mist">{t('boundaries.neverCards')}</p>
        {me.neverCards.length === 0 ? (
          <p className="text-sm text-mist/80">{t('boundaries.none')}</p>
        ) : (
          <ul className="space-y-2">
            {me.neverCards.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-ink/50 px-3 py-2 text-sm">
                <span>{c.title}</span>
                <button
                  type="button"
                  className="min-h-12 px-3 text-rose underline-offset-4 hover:underline"
                  onClick={() => void save({ neverCardIds: b.neverCardIds.filter((x) => x !== c.id) })}
                >
                  {t('common.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
