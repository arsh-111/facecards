import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DisplayNameSchema, type Genre } from '@nc/shared';
import { t } from '../i18n';
import { api, ApiError } from '../lib/api';
import { disconnectRoom } from '../lib/sync';
import { useApp, useSettings } from '../store';
import { Shell } from '../components/chrome';
import { Button, Panel, SectionTitle, Segmented, Toggle } from '../components/ui';
import { BoundariesEditor, GenderPicker, GenrePicker, PreferencePicker } from '../components/forms';
import { Header } from './Home';

export function SettingsScreen() {
  const me = useApp((s) => s.me);
  const setMe = useApp((s) => s.setMe);
  const patchSettings = useApp((s) => s.patchSettings);
  const showToast = useApp((s) => s.showToast);
  const settings = useSettings();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.profile.displayName ?? '');
  const [age, setAge] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  if (!me) return null;
  const p = me.profile;

  const patch = async (body: Parameters<typeof api.patchMe>[0]) => {
    setError('');
    try {
      setMe(await api.patchMe(body));
      showToast(t('common.saved'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AGE_BLOCKED') {
        disconnectRoom();
        setMe(null);
        navigate('/blocked', { replace: true });
      } else setError(t(`errors.${e instanceof ApiError ? e.code : 'SERVER_ERROR'}`));
    }
  };

  const wipe = async () => {
    await api.deleteMe().catch(() => {});
    disconnectRoom();
    setMe(null);
    showToast(t('settings.deleted'));
    navigate('/', { replace: true });
  };

  return (
    <Shell header={<Header />}>
      <div className="flex items-center justify-between">
        <h1 className="my-4 font-display text-3xl text-rose">{t('settings.title')}</h1>
        {me.currentRoom && (
          <Link to={`/room/${me.currentRoom}`} className="text-sm text-rose underline-offset-4 hover:underline">
            ← {me.currentRoom}
          </Link>
        )}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-rose">{error}</p>}
      <div className="space-y-4">
        <Panel>
          <SectionTitle>{t('settings.profile')}</SectionTitle>
          <div className="space-y-5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = name.trim();
                if (v && !DisplayNameSchema.safeParse(v).success) return setError(t('register.invalidName'));
                void patch({ displayName: v || null });
              }}
            >
              <label className="flex-1">
                <span className="mb-1 block text-sm text-mist">{t('settings.nickname')}</span>
                <input
                  value={name}
                  maxLength={20}
                  onChange={(e) => setName(e.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-rose/20 bg-ink/60 px-4 text-blush"
                />
              </label>
              <Button type="submit" variant="ghost" className="self-end">{t('common.save')}</Button>
            </form>
            <div>
              <p className="mb-2 text-sm text-mist">{t('settings.gender')}</p>
              <GenderPicker value={p.gender} onChange={(gender) => void patch({ gender })} />
            </div>
            <div>
              <p className="mb-2 text-sm text-mist">{t('settings.preference')}</p>
              <PreferencePicker value={p.preference} onChange={(preference) => void patch({ preference })} />
            </div>
            <div>
              <p className="mb-2 text-sm text-mist">{t('settings.genres')}</p>
              <GenrePicker
                value={p.genres}
                onChange={(genres: Genre[]) => genres.length > 0 && void patch({ genres })}
              />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(age);
                if (Number.isInteger(n) && n > 0) void patch({ age: n });
              }}
            >
              <label className="flex-1">
                <span className="mb-1 block text-sm text-mist">{t('settings.age')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-rose/20 bg-ink/60 px-4 text-blush"
                />
                <span className="mt-1 block text-xs text-mist">{t('settings.ageHint')} ({p.ageBand})</span>
              </label>
              <Button type="submit" variant="ghost" className="self-start mt-6" disabled={!age}>{t('common.save')}</Button>
            </form>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>{t('boundaries.title')}</SectionTitle>
          <BoundariesEditor />
        </Panel>

        <Panel>
          <SectionTitle>{t('settings.experience')}</SectionTitle>
          <div className="space-y-2">
            <Toggle label={t('settings.sound')} checked={settings.sound} onChange={(sound) => void patchSettings({ sound })} />
            <Toggle
              label={t('settings.ambient')}
              checked={settings.ambient}
              disabled={!settings.sound}
              onChange={(ambient) => void patchSettings({ ambient })}
            />
            <Toggle label={t('settings.haptics')} checked={settings.haptics} onChange={(haptics) => void patchSettings({ haptics })} />
            <div className="py-2">
              <p className="mb-2">{t('settings.animation')}</p>
              <Segmented
                label={t('settings.animation')}
                value={settings.animation}
                onChange={(animation) => void patchSettings({ animation })}
                options={[
                  { value: 'full', label: t('settings.animationFull') },
                  { value: 'reduced', label: t('settings.animationReduced') },
                ]}
              />
            </div>
            <div className="py-2">
              <p className="mb-2">{t('settings.theme')}</p>
              <Segmented
                label={t('settings.theme')}
                value={settings.themeIntensity}
                onChange={(themeIntensity) => void patchSettings({ themeIntensity })}
                options={(['subtle', 'normal', 'rich'] as const).map((v) => ({ value: v, label: t(`settings.themeLevels.${v}`) }))}
              />
            </div>
            <div className="py-2">
              <p className="mb-2">{t('settings.language')}</p>
              <Segmented label={t('settings.language')} value={settings.language} onChange={() => {}} options={[{ value: 'en', label: 'English' }]} />
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>{t('settings.privacy')}</SectionTitle>
          <p className="mb-4 text-sm text-mist">{t('settings.expires')}</p>
          {confirmDelete ? (
            <div className="space-y-3" role="alertdialog" aria-label={t('settings.delete')}>
              <p className="text-sm">{t('settings.deleteConfirm')}</p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </Button>
                <Button className="flex-1" onClick={() => void wipe()}>
                  {t('settings.deleteYes')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)}>
              {t('settings.delete')}
            </Button>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
