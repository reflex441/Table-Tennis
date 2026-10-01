import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SettingsProvider } from "@/components/SettingsProvider";
import { NotificationProvider } from "@/components/NotificationProvider";
import { AlarmRinger } from "@/components/AlarmRinger";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth/current";
import type { PublicUser } from "@/lib/auth/accounts";
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
  screenshotsAreToday: true,
  screenshotTimesAreLocal: true,
  ringUntilAck: true,
  repeatSeconds: 30,
  alarmVolume: 15,
  alarmSound: "siren",
  unitSize: 10,
  currency: "$",
  useAverageOdds: false,
  averageOdds: 1.85,
  geminiModel: "gemini-3.5-flash-lite",
  geminiFallbackModel: "gemini-3.8-flash",
  showOnLeaderboard: true,
  leagueLinks: [],
  geminiKeySource: "none",
  geminiKeyHint: null,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  let settings = FALLBACK_SETTINGS;
  let user: PublicUser | null = null;
  let dbError = false;
  try {
    user = await getCurrentUser();
    if (user) settings = await getSettings(db(), user.id);
  } catch (err) {
    console.error("Failed to load the session or settings", err);
    dbError = true;
  }

  // Signed out: only the sign-in / sign-up pages render (no polling, no alarms).
  if (!user) {
    return (
      <html lang="en" className="h-full antialiased">
        <body className="min-h-full">
          {dbError && (
            <div className="border-b border-rose-900/60 bg-rose-950/40 px-4 py-2 text-center text-sm text-rose-200">
              Cannot reach the database. Check DATABASE_URL and run the migrations (see README).
            </div>
          )}
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <SettingsProvider initial={settings}>
          <NotificationProvider>
            <AppShell dbError={dbError} user={user}>
              {children}
            </AppShell>
            <AlarmRinger />
          </NotificationProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
