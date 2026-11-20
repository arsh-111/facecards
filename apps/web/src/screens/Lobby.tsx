import { useState } from 'react';
import { GENDERS, INTENSITIES, PREFERENCES, type Gender, type Preference, type RoomSnapshot } from '@nc/shared';
import { t } from '../i18n';
import { act } from '../lib/sync';
import { useApp } from '../store';
import { Button, Panel, SectionTitle, Segmented, Toggle } from '../components/ui';
import { BoundariesEditor, GenrePicker, RolePrefsEditor } from '../components/forms';

function useAct() {
  const showToast = useApp((s) => s.showToast);
  return async (...args: Parameters<typeof act>) => {
    const r = await act(...args);
    if (!r.ok && r.error) showToast(t(`errors.${r.error}`) === `errors.${r.error}` ? t('common.error') : t(`errors.${r.error}`));
    return r;
  };
}

function LocalPlayerForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; gender: Gender; preference: Preference };
  onSubmit(p: { name: string; gender: Gender; preference: Preference }): void;
  onCancel?(): void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [gender, setGender] = useState<Gender>(initial?.gender ?? 'woman');
  const [preference, setPreference] = useState<Preference>(initial?.preference ?? 'both');
  return (
    <form
      className="space-y-3 rounded-2xl bg-ink/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length >= 2) onSubmit({ name: name.trim(), gender, preference });
      }}
    >
      <input
        value={name}
        maxLength={20}
        placeholder={t('lobby.playerName')}
        aria-label={t('lobby.playerName')}
        onChange={(e) => setName(e.target.value)}
        className="min-h-12 w-full rounded-2xl border border-rose/20 bg-ink/60 px-4 text-blush"
      />
      <Segmented label={t('settings.gender')} value={gender} onChange={setGender} options={GENDERS.map((g) => ({ value: g, label: t(`gender.${g}`) }))} />
      <Segmented label={t('settings.preference')} value={preference} onChange={setPreference} options={PREFERENCES.map((p) => ({ value: p, label: t(`preference.${p}`) }))} />
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={name.trim().length < 2}>
          {initial ? t('common.save') : t('common.add')}
        </Button>
      </div>
    </form>
  );
}

export function Lobby({ room, onLeave }: { room: RoomSnapshot; onLeave(): void }) {
  const run = useAct();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [copied, setCopied] = useState(false);
  const host = room.isHost;
  const you = room.players.find((p) => p.isYou);
  const passPlay = room.mode === 'pass_and_play';
  const link = `${location.origin}/join/${room.code}`;
  const trackLabel = (tr: string) => room.knownTracks.find((k) => k.track === tr)?.label ?? tr;

  const copy = async () => {
    try {
      if (navigator.share) await navigator.share({ url: link, title: 'Nights' });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="space-y-4 pb-28">
      <h1 className="mt-2 font-display text-3xl text-rose">{t('lobby.title')}</h1>

      {!passPlay && (
        <Panel>
          <p className="text-sm text-mist">{t('lobby.code')}</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="font-mono text-3xl tracking-[0.3em] text-blush" data-testid="room-code">
              {room.code}
            </span>
            <Button variant="ghost" onClick={() => void copy()} aria-label={t('lobby.shareLink')}>
              {copied ? t('common.copied') : t('common.share')}
            </Button>
          </div>
        </Panel>
      )}

      <Panel>
        <SectionTitle>{t('lobby.players')}</SectionTitle>
        <ul className="space-y-2">
          {room.players.map((p) => (
            <li key={p.id} className="rounded-2xl bg-ink/40 px-3 py-2">
              <div className="flex min-h-12 items-center justify-between gap-2">
                <span>
                  <span aria-hidden className={`mr-2 inline-block h-2 w-2 rounded-full ${p.connected && !p.away ? 'bg-rose' : 'bg-mist/40'}`} />
                  {p.name}
                  <span className="ml-2 text-xs text-mist">
                    {[p.isYou && t('common.you'), p.isHost && t('common.host'), p.away && t('common.away'), t(`gender.${p.gender}`)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex gap-1">
                  {host && p.local && (
                    <>
                      <button type="button" className="min-h-12 px-2 text-sm text-rose" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" className="min-h-12 px-2 text-sm text-mist" onClick={() => void run('room:removeLocal', { playerId: p.id })}>
                        {t('common.remove')}
                      </button>
                    </>
                  )}
                  {host && !passPlay && !p.isYou && (
                    <button
                      type="button"
                      aria-label={t('lobby.kick', { name: p.name })}
                      className="min-h-12 px-2 text-sm text-mist hover:text-rose"
                      onClick={() => void run('host:kick', { playerId: p.id })}
                    >
                      {t('common.remove')}
                    </button>
                  )}
                </span>
              </div>
              {editing === p.id && (
                <div className="mt-2 space-y-3">
                  <LocalPlayerForm
                    initial={{ name: p.name, gender: p.gender, preference: p.preference }}
                    onCancel={() => setEditing(null)}
                    onSubmit={(player) => {
                      void run('room:updateLocal', { playerId: p.id, player });
                      setEditing(null);
                    }}
                  />
                  <RolePrefsEditor
                    title={t('lobby.rolesFor', { name: p.name })}
                    value={p.rolePrefs}
                    onChange={(rolePrefs) => void run('room:setRolePrefs', { playerId: p.id, rolePrefs })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        {passPlay && host && room.players.length < room.maxPlayers && (
          <div className="mt-3">
            {adding ? (
              <LocalPlayerForm
                onCancel={() => setAdding(false)}
                onSubmit={(player) => {
                  void run('room:addLocal', { player });
                  setAdding(false);
                }}
              />
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setAdding(true)}>
                + {t('lobby.addPlayer')}
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle>{t('lobby.track')}</SectionTitle>
        {room.track ? (
          <p className="text-blush">{trackLabel(room.track)}</p>
        ) : room.players.length < 2 ? (
          <p className="text-sm text-mist">{t('lobby.blocker.needPlayers')}</p>
        ) : (
          <div className="space-y-3">
            <p className="font-medium text-rose">{t('lobby.noTrack')}</p>
            <p className="text-sm text-mist">{t('lobby.noTrackBody')}</p>
            {room.trackProposal && (
              <p className="text-sm">
                {t('lobby.waitingConfirm', { n: room.trackProposal.confirmedBy.length, total: room.players.length })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {host &&
                room.knownTracks.map((k) => (
                  <Button key={k.track} variant="ghost" onClick={() => void run('room:proposeTrack', { track: k.track })}>
                    {t('lobby.proposeTrack', { track: k.label })}
                  </Button>
                ))}
              {room.trackProposal && you && !room.trackProposal.confirmedBy.includes(you.id) && (
                <Button onClick={() => void run('room:confirmTrack')}>
                  {t('lobby.confirmTrack', { track: trackLabel(room.trackProposal.track) })}
                </Button>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle>{t('lobby.genres')}</SectionTitle>
        {room.availableGenres.length === 0 && room.players.length >= 2 ? (
          <p className="text-sm text-mist">{t('lobby.noCommonGenres')}</p>
        ) : (
          <GenrePicker
            value={room.genres}
            options={room.availableGenres}
            disabled={!host}
            onChange={(genres) => void run('room:setGenres', { genres })}
          />
        )}
      </Panel>

      <Panel>
        <div className="space-y-5">
          {room.intensityAvailable && (
            <div>
              <SectionTitle>{t('lobby.intensity')}</SectionTitle>
              <Segmented
                label={t('lobby.intensity')}
                value={room.intensity ?? 'any'}
                disabled={!host}
                onChange={(v) => void run('room:setOptions', { intensity: v === 'any' ? null : v })}
                options={[{ value: 'any', label: t('intensity.any') }, ...INTENSITIES.map((i) => ({ value: i, label: t(`intensity.${i}`) }))]}
              />
            </div>
          )}
          <div>
            <SectionTitle>{t('lobby.turnMode')}</SectionTitle>
            <Segmented
              label={t('lobby.turnMode')}
              value={room.turnMode}
              disabled={!host}
              onChange={(turnMode) => void run('room:setOptions', { turnMode })}
              options={(['alternate', 'random', 'host'] as const).map((v) => ({ value: v, label: t(`lobby.turn.${v}`) }))}
            />
          </div>
          <div>
            <SectionTitle>{t('lobby.timer')}</SectionTitle>
            <Segmented
              label={t('lobby.timer')}
              value={room.timerMode}
              disabled={!host}
              onChange={(timerMode) => void run('room:setOptions', { timerMode })}
              options={(['manual', 'auto'] as const).map((v) => ({ value: v, label: t(`lobby.timerMode.${v}`) }))}
            />
          </div>
          {!passPlay && (
            <Toggle
              label={t('lobby.pauseOnAway')}
              checked={room.pauseOnAway}
              disabled={!host}
              onChange={(pauseOnAway) => void run('room:setOptions', { pauseOnAway })}
            />
          )}
        </div>
      </Panel>

      {you && (
        <Panel>
          <RolePrefsEditor
            title={t('lobby.roles')}
            value={you.rolePrefs}
            onChange={(rolePrefs) => void run('room:setRolePrefs', { playerId: you.id, rolePrefs })}
          />
        </Panel>
      )}

      <Panel>
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between font-display text-lg text-rose"
          aria-expanded={showBoundaries}
          onClick={() => setShowBoundaries(!showBoundaries)}
        >
          {t('lobby.boundaries')}
          <span aria-hidden>{showBoundaries ? '−' : '+'}</span>
        </button>
        {showBoundaries && (
          <div className="mt-3">
            <BoundariesEditor />
          </div>
        )}
      </Panel>

      <Button variant="quiet" onClick={onLeave}>
        {t('lobby.leave')}
      </Button>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rose/10 bg-ink/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          {room.blockers.length > 0 && (
            <p className="mb-2 text-center text-xs text-mist" role="status">
              {room.blockers.map((b) => t(`lobby.blocker.${b}`)).join(' ')}
            </p>
          )}
          {host ? (
            <Button className="rim w-full text-lg" disabled={room.blockers.length > 0} onClick={() => void run('room:start')}>
              {t('lobby.start')}
            </Button>
          ) : (
            <p className="py-3 text-center text-mist" role="status">
              {t('lobby.waitingHost')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

