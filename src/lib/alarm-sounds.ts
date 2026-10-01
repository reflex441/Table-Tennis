/** Alarm sound choices (server- and client-safe; the audio itself is in siren.ts). */
export const ALARM_SOUNDS = ["siren", "classic", "chime", "pulse", "rising"] as const;
export type AlarmSound = (typeof ALARM_SOUNDS)[number];

export const ALARM_SOUND_LABEL: Record<AlarmSound, { label: string; hint: string }> = {
  siren: { label: "Siren", hint: "Harsh high/low beeps (most attention-grabbing)" },
  classic: { label: "Alarm clock", hint: "Classic beep-beep-beep-beep" },
  chime: { label: "Chime", hint: "Soft bell, easy on the ears" },
  pulse: { label: "Pulse", hint: "Gentle low hum that swells in and out" },
  rising: { label: "Rising", hint: "Whoop that sweeps upwards" },
};

export function isAlarmSound(v: unknown): v is AlarmSound {
  return typeof v === "string" && (ALARM_SOUNDS as readonly string[]).includes(v);
}
