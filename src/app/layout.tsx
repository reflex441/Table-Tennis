import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SettingsProvider } from "@/components/SettingsProvider";
import { NotificationProvider } from "@/components/NotificationProvider";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { SettingsDTO } from "@/lib/validation/settings";

export const metadata: Metadata = {
  title: "TT Alarms - Table tennis match reminders",
  description: "Turn screenshots of table tennis matches into scheduled reminders.",
  applicationName: "TT Alarms",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "TT Alarms", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const FALLBACK_SETTINGS: SettingsDTO = {
  defaultReminderMinutes: 5,
  timezone: "Australia/Sydney",
  timezoneConfirmed: true,
  dateOrder: "DMY",
  pushEnabled: true,
  inAppEnabled: true,
  soundEnabled: true,
  includeStatsInNotification: true,
  geminiKeySource: "none",
  geminiKeyHint: null,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  let settings = FALLBACK_SETTINGS;
  let dbError = false;
  try {
    settings = await getSettings(db());
  } catch (err) {
    console.error("Failed to load settings", err);
    dbError = true;
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <SettingsProvider initial={settings}>
          <NotificationProvider>
            <AppShell dbError={dbError}>{children}</AppShell>
          </NotificationProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
