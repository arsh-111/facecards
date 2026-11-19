import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { useApp, useSettings } from './store';
import { useReduced } from './lib/motion';
import { haptics, sound } from './lib/feedback';
import { triggerPanic, useShake } from './lib/panic';
import { setLanguage } from './i18n';
import { Decoy, Toast } from './components/chrome';
import { Landing } from './screens/Landing';
import { Register } from './screens/Register';
import { Blocked } from './screens/Blocked';
import { Home } from './screens/Home';
import { RoomScreen } from './screens/Room';
import { SettingsScreen } from './screens/Settings';
import { Info } from './screens/Info';
import { JoinLink } from './screens/JoinLink';

function RequireSession({ children }: { children: JSX.Element }) {
  const me = useApp((s) => s.me);
  const loaded = useApp((s) => s.meLoaded);
  if (!loaded) return null;
  if (!me) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const loadMe = useApp((s) => s.loadMe);
  const decoy = useApp((s) => s.decoy);
  const settings = useSettings();
  const reduced = useReduced();

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    sound.enabled = settings.sound;
    haptics.enabled = settings.haptics;
    sound.setAmbient(settings.sound && settings.ambient);
    setLanguage(settings.language);
    document.documentElement.dataset.glow = settings.themeIntensity;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [settings, reduced]);

  useShake(triggerPanic);

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <BrowserRouter>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50">
          Skip to content
        </a>
        <div aria-hidden={decoy} className={decoy ? 'hidden' : undefined}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/register" element={<Register />} />
            <Route path="/blocked" element={<Blocked />} />
            <Route path="/join/:code" element={<JoinLink />} />
            <Route path="/privacy" element={<Info kind="privacy" />} />
            <Route path="/terms" element={<Info kind="terms" />} />
            <Route path="/home" element={<RequireSession><Home /></RequireSession>} />
            <Route path="/room/:code" element={<RequireSession><RoomScreen /></RequireSession>} />
            <Route path="/settings" element={<RequireSession><SettingsScreen /></RequireSession>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {decoy && <Decoy />}
        <Toast />
      </BrowserRouter>
    </MotionConfig>
  );
}
