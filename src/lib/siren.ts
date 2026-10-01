"use client";

/**
 * Loud repeating alarm generated with Web Audio (no audio file needed).
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

/** Start the siren; returns a function that stops it. */
export function startSiren(volume = 0.4): () => void {
  const c = getContext();
  if (!c) return () => {};
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);
  let stopped = false;

  // Four harsh square-wave beeps alternating high/low, repeated every 1.1 s.
  const burst = () => {
    if (stopped || c.state !== "running") return;
    const t0 = c.currentTime + 0.02;
    for (let i = 0; i < 4; i++) {
      const start = t0 + i * 0.18;
      const osc = c.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(i % 2 ? 1320 : 880, start);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.01);
      gain.gain.setValueAtTime(1, start + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  };
  burst();
  const timer = setInterval(burst, 1100);
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
