import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { DisplayNameSchema, MIN_AGE, type Genre } from '@nc/shared';
import { t } from '../i18n';
import { api, ApiError } from '../lib/api';
import { useApp } from '../store';
import { Logo, Shell } from '../components/chrome';
import { Button } from '../components/ui';
import { GenderPicker, GenrePicker, PreferencePicker } from '../components/forms';

const STEPS = ['age', 'gender', 'preference', 'genres', 'name'] as const;

export function Register() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setMe = useApp((s) => s.setMe);
  const [step, setStep] = useState(0);
  const [useDob, setUseDob] = useState(false);
  const [age, setAge] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [preference, setPreference] = useState('');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const current = STEPS[step] as (typeof STEPS)[number];
  const ageNum = Number(age);
  const valid =
    current === 'age'
      ? useDob
        ? /^\d{4}-\d{2}-\d{2}$/.test(dob)
        : Number.isInteger(ageNum) && ageNum > 0 && ageNum < 130
      : current === 'gender'
        ? !!gender
        : current === 'preference'
          ? !!preference
          : current === 'genres'
            ? genres.length > 0
            : name.trim() === '' || DisplayNameSchema.safeParse(name).success;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const me = await api.register({
        ...(useDob ? { dob } : { age: ageNum }),
        gender,
        preference,
        genres,
        displayName: name.trim() || undefined,
      });
      setMe(me);
      const next = params.get('next');
      navigate(next?.startsWith('/') ? next : '/home', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AGE_BLOCKED') navigate('/blocked', { replace: true });
      else setError(t(`errors.${e instanceof ApiError ? e.code : 'SERVER_ERROR'}`));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!valid) return;
    // Client-side early exit; the server enforces the real gate.
    if (current === 'age' && !useDob && ageNum < MIN_AGE) {
      navigate('/blocked', { replace: true });
      return;
    }
    if (step === STEPS.length - 1) void submit();
    else setStep(step + 1);
  };

  return (
    <Shell header={<div className="py-2"><Logo /></div>} footer={false}>
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <div className="mt-6 flex items-center justify-center gap-2" aria-label={t('register.stepOf', { n: step + 1, total: STEPS.length })} role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-2 rounded-full transition-all ${i === step ? 'w-8 bg-rose shadow-rose' : i < step ? 'w-2 bg-crimson' : 'w-2 bg-mist/30'}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, x: 40, filter: 'blur(8px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -40, filter: 'blur(8px)' }}
            transition={{ duration: 0.45 }}
            className="mt-10 flex-1"
          >
            {current === 'age' && (
              <div className="space-y-4">
                <h1 className="font-display text-3xl text-rose">{t('register.age.title')}</h1>
                {useDob ? (
                  <label className="block">
                    <span className="mb-2 block text-sm text-mist">{t('register.age.dobLabel')}</span>
                    <input
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="glass min-h-12 w-full rounded-2xl px-4 text-lg text-blush"
                      autoFocus
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-2 block text-sm text-mist">{t('register.age.label')}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={129}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="glass min-h-12 w-full rounded-2xl px-4 text-2xl text-blush"
                      autoFocus
                      name="age"
                    />
                  </label>
                )}
                <button type="button" className="text-sm text-rose underline-offset-4 hover:underline" onClick={() => setUseDob(!useDob)}>
                  {useDob ? t('register.age.useAge') : t('register.age.useDob')}
                </button>
                <p className="text-xs text-mist">{t('register.age.hint')}</p>
              </div>
            )}
            {current === 'gender' && (
              <div className="space-y-6">
                <h1 className="font-display text-3xl text-rose">{t('register.gender.title')}</h1>
                <GenderPicker value={gender} onChange={setGender} />
              </div>
            )}
            {current === 'preference' && (
              <div className="space-y-6">
                <h1 className="font-display text-3xl text-rose">{t('register.preference.title')}</h1>
                <PreferencePicker value={preference} onChange={setPreference} />
              </div>
            )}
            {current === 'genres' && (
              <div className="space-y-6">
                <h1 className="font-display text-3xl text-rose">{t('register.genres.title')}</h1>
                <p className="text-sm text-mist">{t('register.genres.hint')}</p>
                <GenrePicker value={genres} onChange={setGenres} />
              </div>
            )}
            {current === 'name' && (
              <div className="space-y-4">
                <h1 className="font-display text-3xl text-rose">{t('register.name.title')}</h1>
                <label className="block">
                  <span className="mb-2 block text-sm text-mist">{t('register.name.label')}</span>
                  <input
                    value={name}
                    maxLength={20}
                    onChange={(e) => setName(e.target.value)}
                    className="glass min-h-12 w-full rounded-2xl px-4 text-lg text-blush"
                    autoComplete="off"
                    name="nickname"
                    autoFocus
                  />
                </label>
                <p className="text-xs text-mist">{t('register.name.hint')}</p>
                {!valid && <p className="text-sm text-rose">{t('register.invalidName')}</p>}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {error && (
          <p role="alert" className="mb-3 text-center text-sm text-rose">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 flex gap-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)} className="flex-1">
              {t('common.back')}
            </Button>
          )}
          <Button type="submit" disabled={!valid || busy} className="flex-[2]">
            {step === STEPS.length - 1 ? t('register.name.submit') : t('common.next')}
          </Button>
        </div>
      </form>
    </Shell>
  );
}
