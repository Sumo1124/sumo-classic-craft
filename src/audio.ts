export type SoundEffect = 'flip' | 'match' | 'mismatch' | 'hint' | 'clear' | 'reward';

export type GameAudio = {
  play: (effect: SoundEffect) => void;
  playClip: (url: string, volume?: number) => void;
  playMusic: (url: string | null) => void;
  isMuted: () => boolean;
  toggleMute: () => boolean;
  destroy: () => void;
};

const MUTE_KEY = 'sumo-classic-craft:audio-muted:v1';
type AudioContextConstructor = typeof AudioContext;

function storedMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Small synthesized effects; audio is created only after a user interaction. */
export function createGameAudio(): GameAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = storedMute();
  let destroyed = false;
  let music: HTMLAudioElement | null = null;
  let musicUrl: string | null = null;
  const activeClips = new Set<HTMLAudioElement>();

  const syncGain = () => {
    if (music) music.volume = muted || document.hidden ? 0 : 0.14;
    if (!context || !master) return;
    const level = muted || document.hidden ? 0 : 0.16;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(level, context.currentTime, 0.015);
  };

  const stopClip = (clip: HTMLAudioElement) => {
    activeClips.delete(clip);
    clip.onended = null;
    clip.pause();
    clip.src = '';
  };

  const stopMusic = () => {
    if (!music) return;
    music.onended = null;
    music.pause();
    music.src = '';
    music = null;
    musicUrl = null;
  };

  const ensureContext = (): AudioContext | null => {
    if (destroyed || muted) return null;
    try {
      if (!context) {
        const Context = (window.AudioContext
          ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext);
        if (!Context) return null;
        context = new Context();
        master = context.createGain();
        master.gain.value = 0;
        master.connect(context.destination);
        syncGain();
      }
      if (context.state === 'suspended' && !document.hidden) void context.resume().catch(() => undefined);
      return context;
    } catch {
      return null;
    }
  };

  const unlock = () => {
    ensureContext();
    if (music && musicUrl && music.paused && !muted && !document.hidden) {
      void music.play().catch(() => undefined);
    }
  };

  const visibility = () => {
    syncGain();
    if (!context) return;
    if (document.hidden) {
      void context.suspend().catch(() => undefined);
    } else if (!muted) {
      void context.resume().catch(() => undefined);
    }
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', visibility);

  function tone(
    frequency: number,
    offset: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
    endFrequency = frequency,
  ) {
    if (!context || !master) return;
    const start = context.currentTime + offset;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  return {
    play(effect) {
      if (destroyed || muted || document.hidden) return;
      const audio = ensureContext();
      if (!audio) return;
      try {
        switch (effect) {
          case 'flip':
            tone(260, 0, 0.075, 0.18, 'triangle', 390);
            break;
          case 'match':
            tone(520, 0, 0.16, 0.18, 'sine', 660);
            tone(780, 0.07, 0.2, 0.13, 'sine', 920);
            break;
          case 'mismatch':
            tone(210, 0, 0.15, 0.13, 'triangle', 145);
            break;
          case 'hint':
            tone(660, 0, 0.18, 0.12, 'sine', 880);
            tone(990, 0.1, 0.22, 0.1, 'sine', 1180);
            break;
          case 'clear':
            [392, 523, 659, 784].forEach((note, index) => tone(note, index * 0.085, 0.32, 0.13, 'triangle'));
            break;
          case 'reward':
            tone(880, 0, 0.16, 0.12, 'sine', 1320);
            tone(1320, 0.12, 0.3, 0.14, 'sine', 1760);
            break;
        }
      } catch {
        // Sound is optional and must never interrupt an authoritative game result.
      }
    },
    isMuted: () => muted,
    playClip(url, volume = 0.5) {
      if (destroyed || muted || document.hidden) return;
      try {
        const clip = new Audio(url);
        clip.volume = Math.max(0, Math.min(1, volume));
        activeClips.add(clip);
        clip.onended = () => stopClip(clip);
        if (activeClips.size > 12) {
          const oldest = activeClips.values().next().value;
          if (oldest) stopClip(oldest);
        }
        void clip.play().catch(() => stopClip(clip));
      } catch {
        // Missing or blocked audio must never interrupt combat.
      }
    },
    playMusic(url) {
      if (destroyed) return;
      if (url === musicUrl) return;
      stopMusic();
      if (!url) return;
      try {
        musicUrl = url;
        music = new Audio(url);
        music.loop = true;
        music.volume = muted || document.hidden ? 0 : 0.14;
        void music.play().catch(() => {
          // Keep the desired track so the next pointer or keyboard gesture can retry it.
        });
      } catch {
        music = null;
        musicUrl = null;
      }
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, String(muted));
      } catch {
        // Storage can be unavailable in privacy modes; the current session still works.
      }
      if (!muted) ensureContext();
      syncGain();
      if (music && muted) music.pause();
      else if (music && !muted) void music.play().catch(() => undefined);
      return muted;
    },
    destroy() {
      destroyed = true;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', visibility);
      for (const clip of [...activeClips]) stopClip(clip);
      stopMusic();
      const current = context;
      context = null;
      master?.disconnect();
      master = null;
      if (current) void current.close().catch(() => undefined);
    },
  };
}
