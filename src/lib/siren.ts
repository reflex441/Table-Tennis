"use client";

import type { AlarmSound } from "./alarm-sounds";

/**
 * Repeating alarm generated with Web Audio (no audio file needed). Its
 * loudness is the "Alarm volume" setting.
 *
 * Browsers only allow sound after the user has interacted with the page at
 * least once, so the shared AudioContext is "unlocked" on the first click or
 * key press and reused for every alarm afterwards.
 */

let ctx: AudioContext | null = null;
let unlockListenersAdded = false;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Resume audio on the first user gesture so later alarms can play. */
export function installAudioUnlock(): void {
  if (unlockListenersAdded || typeof window === "undefined") return;
  unlockListenersAdded = true;
  const unlock = () => {
    const c = getContext();
    if (c && c.state !== "running") void c.resume();
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

export function audioUnlocked(): boolean {
  return ctx?.state === "running";
}

export async function unlockAudio(): Promise<boolean> {
  const c = getContext();
  if (!c) return false;
  if (c.state !== "running") await c.resume().catch(() => {});
  return c.state === "running";
}

/** Loudest level at 100% volume for the harshest sound (the default setting is 15%). */
const MAX_GAIN = 0.4;

/** Volume setting (1-100) -> gain. */
export function volumeToGain(volume: number): number {
  return (Math.min(100, Math.max(0, volume)) / 100) * MAX_GAIN;
}

type Burst = (c: AudioContext, out: AudioNode, t0: number) => void;

/** One-off tone with an attack/release envelope. */
function tone(c: AudioContext, out: AudioNode, opts: { type: OscillatorType; freq: number; start: number; length: number; peak?: number; attack?: number; endFreq?: number }) {
  const { type, freq, start, length, peak = 1, attack = 0.01, endFreq } = opts;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + length);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/**
 * Each sound: what one repetition plays, how often it repeats, and a level
 * so all sounds are roughly as loud as each other at the same volume.
 */
const SOUNDS: Record<AlarmSound, { burst: Burst; periodMs: number; level: number }> = {
  // Four harsh square-wave beeps alternating high/low.
  siren: {
    periodMs: 1100,
    level: 1,
    burst: (c, out, t0) => {
      for (let i = 0; i < 4; i++) tone(c, out, { type: "square", freq: i % 2 ? 1320 : 880, start: t0 + i * 0.18, length: 0.17 });
    },
  },
  // beep-beep-beep-beep, pause.
  classic: {
    periodMs: 1000,
    level: 0.9,
    burst: (c, out, t0) => {
      for (let i = 0; i < 4; i++) tone(c, out, { type: "square", freq: 1000, start: t0 + i * 0.13, length: 0.08, attack: 0.005 });
    },
  },
  // Two soft bell notes that ring out.
  chime: {
    periodMs: 1800,
    level: 2.2,
    burst: (c, out, t0) => {
      tone(c, out, { type: "sine", freq: 784, start: t0, length: 1.2, peak: 0.6, attack: 0.008 });
      tone(c, out, { type: "sine", freq: 1568, start: t0, length: 0.5, peak: 0.15, attack: 0.008 });
      tone(c, out, { type: "sine", freq: 1047, start: t0 + 0.45, length: 1.2, peak: 0.6, attack: 0.008 });
      tone(c, out, { type: "sine", freq: 2094, start: t0 + 0.45, length: 0.5, peak: 0.15, attack: 0.008 });
    },
  },
  // A low tone that swells in and out.
  pulse: {
    periodMs: 1300,
    level: 2.4,
    burst: (c, out, t0) => {
      tone(c, out, { type: "sine", freq: 440, start: t0, length: 0.9, peak: 0.8, attack: 0.35 });
      tone(c, out, { type: "triangle", freq: 220, start: t0, length: 0.9, peak: 0.3, attack: 0.35 });
    },
  },
  // An upward sweep.
  rising: {
    periodMs: 1000,
    level: 1.6,
    burst: (c, out, t0) => {
      tone(c, out, { type: "triangle", freq: 500, endFreq: 1400, start: t0, length: 0.75, peak: 0.9, attack: 0.05 });
    },
  },
};


/** Start the alarm sound at a volume of 1-100; returns a function that stops it. */
export function startSiren(volume = 15, sound: AlarmSound = "siren"): () => void {
  const c = getContext();
  if (!c) return () => {};
  const spec = SOUNDS[sound] ?? SOUNDS.siren;
  const master = c.createGain();
  master.gain.value = Math.min(1, volumeToGain(volume) * spec.level);
  master.connect(c.destination);
  let stopped = false;

  const burst = () => {
    if (stopped || c.state !== "running") return;
    spec.burst(c, master, c.currentTime + 0.02);
  };
  burst();
  const timer = setInterval(burst, spec.periodMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    try {
      master.disconnect();
    } catch {
      /* already disconnected */
    }
  };
}

/** Play a single round of an alarm sound (used for the in-app notification chime). */
export function playOnce(volume = 15, sound: AlarmSound = "chime"): void {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const spec = SOUNDS[sound] ?? SOUNDS.chime;
  const master = c.createGain();
  master.gain.value = Math.min(1, volumeToGain(volume) * spec.level);
  master.connect(c.destination);
  spec.burst(c, master, c.currentTime + 0.02);
  setTimeout(() => {
    try {
      master.disconnect();
    } catch {
      /* already disconnected */
    }
  }, 2500);
}
