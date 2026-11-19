/**
 * Sound (Web Audio, synthesized: no audio files or third-party calls) and haptics.
 * Everything is off unless enabled in Settings (Section 8.5).
 */
let ctx: AudioContext | null = null;
let ambient: { stop(): void } | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

export const sound = {
  enabled: false,
  tap() {
    if (this.enabled) tone(660, 0, 0.12, 0.03);
  },
  flip() {
    if (this.enabled) {
      tone(392, 0, 0.25, 0.035, 'triangle');
      tone(523, 0.08, 0.3, 0.03, 'triangle');
    }
  },
  /** Soft chime at timer end (FR-15). */
  chime() {
    if (!this.enabled) return;
    tone(784, 0, 1.2, 0.05);
    tone(1046, 0.15, 1.4, 0.04);
    tone(1318, 0.3, 1.6, 0.03);
  },
  setAmbient(on: boolean) {
    if (!on || !this.enabled) {
      ambient?.stop();
      ambient = null;
      return;
    }
    if (ambient) return;
    const a = audio();
    if (!a) return;
    const master = a.createGain();
    master.gain.value = 0.0001;
    master.gain.exponentialRampToValueAtTime(0.025, a.currentTime + 3);
    const filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.connect(master).connect(a.destination);
    const oscs = [110, 164.81, 220.5].map((f) => {
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    ambient = {
      stop() {
        master.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1);
        oscs.forEach((o) => o.stop(a.currentTime + 1.1));
      },
    };
  },
};

export const haptics = {
  enabled: true,
  buzz(pattern: number | number[] = 30) {
    if (this.enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* unsupported */
      }
    }
  },
};
