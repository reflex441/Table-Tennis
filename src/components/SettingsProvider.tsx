"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { SettingsDTO, SettingsUpdate } from "@/lib/validation/settings";
import { api } from "@/lib/client-api";

interface SettingsContextValue {
  settings: SettingsDTO;
  update: (patch: SettingsUpdate) => Promise<SettingsDTO>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ initial, children }: { initial: SettingsDTO; children: React.ReactNode }) {
  const [settings, setSettings] = useState(initial);
  const update = useCallback(async (patch: SettingsUpdate) => {
    const res = await api<{ settings: SettingsDTO }>("/api/settings", { method: "PUT", json: patch });
    setSettings(res.settings);
    return res.settings;
  }, []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
