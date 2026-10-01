"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, LayoutDashboard, Settings, Upload, AlertTriangle, TrendingUp } from "lucide-react";
import { useNotifications } from "./NotificationProvider";
import { DateTime } from "luxon";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/profit", label: "Profit", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children, dbError }: { children: React.ReactNode; dbError: boolean }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-3 sm:px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent">🏓</span>
            <span>TT Alarms</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${active ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
      </header>

      {dbError && (
        <div className="border-b border-rose-900/60 bg-rose-950/40 px-4 py-2 text-center text-sm text-rose-200">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> Cannot reach the database. Check DATABASE_URL and run the migrations (see README).
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-24 pt-4 sm:px-4 sm:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="grid grid-cols-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function NotificationBell() {
  const { notifications, unread, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread) void markAllRead();
        }}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-under px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 top-10 z-50 max-h-[70vh] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto bg-panel-2 shadow-2xl shadow-black/60">
          <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Notifications</div>
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link href={n.url} onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-line/50">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${n.readAt ? "text-text/80" : "font-semibold"}`}>{n.title}</p>
                      <span className="shrink-0 text-[10px] text-muted">{DateTime.fromISO(n.createdAt).toRelative()}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{n.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
