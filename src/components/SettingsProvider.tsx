"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  // Pick up changes made on another device or tab when coming back to the app.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      api<{ settings: SettingsDTO }>("/api/settings")
        .then((res) => setSettings(res.settings))
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
