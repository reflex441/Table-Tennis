import { after } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_BUDGET_HOURS, savingLevel, type SavingLevel } from "./budget";

/**
 * Measures the server CPU the app uses, so it can stay within the host's free
 * allowance. After every API request the CPU this server process used since
 * the last one is added up - every request, page and background job in
 * between, and a fresh instance's start-up too - and saved per day at most
 * once a minute. Only on Vercel (or with CPU_BUDGET_HOURS set): a server of
 * your own has no such limit.
 */

interface MeterState {
  recordedUs: number;
  pendingUs: number;
  pendingRequests: number;
  flushedAt: number;
  level: SavingLevel;
  levelAt: number;
}

const g = globalThis as unknown as { __ttMeter?: MeterState };
const state = (): MeterState => (g.__ttMeter ??= { recordedUs: 0, pendingUs: 0, pendingRequests: 0, flushedAt: 0, level: 0, levelAt: 0 });

const FLUSH_MS = 60_000;
const LEVEL_CACHE_MS = 10 * 60_000;
const DAYS = 30;

/** Metering is on (a host with a CPU allowance). */
export function meterEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && Boolean(process.env.VERCEL || process.env.CPU_BUDGET_HOURS);
}

/** The allowance in ms (CPU_BUDGET_HOURS, default 4 hours). */
export function budgetMs(): number {
  const hours = Number(process.env.CPU_BUDGET_HOURS);
  return (hours > 0 ? hours : DEFAULT_BUDGET_HOURS) * 3_600_000;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Called after every API request (see handle()). */
export function meterRequest(): void {
  if (!meterEnabled()) return;
  const s = state();
  const u = process.cpuUsage();
  const total = u.user + u.system;
  s.pendingUs += total - s.recordedUs;
  s.recordedUs = total;
  s.pendingRequests += 1;
  const now = Date.now();
  if (now - s.flushedAt < FLUSH_MS) return;
  s.flushedAt = now;
  const cpuMs = Math.round(s.pendingUs / 1000);
  const requests = s.pendingRequests;
  s.pendingUs = 0;
  s.pendingRequests = 0;
  const save = () => recordUsage(db(), cpuMs, requests).catch((err) => console.error("[usage] couldn't save", err));
  try {
    after(save);
  } catch {
    void save();
  }
}

export async function recordUsage(prisma: PrismaClient, cpuMs: number, requests: number, now = new Date()): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "UsageDay" ("day", "cpuMs", "requests") VALUES (${utcDay(now)}, ${cpuMs}, ${requests})
    ON CONFLICT ("day") DO UPDATE SET "cpuMs" = "UsageDay"."cpuMs" + EXCLUDED."cpuMs", "requests" = "UsageDay"."requests" + EXCLUDED."requests"`;
}

/** CPU used in the last 30 days (today included). */
export async function usageLast30Days(prisma: PrismaClient, now = new Date()): Promise<{ cpuMs: number; requests: number }> {
  const since = utcDay(new Date(now.getTime() - (DAYS - 1) * 86_400_000));
  const sum = await prisma.usageDay.aggregate({ where: { day: { gte: since } }, _sum: { cpuMs: true, requests: true } });
  return { cpuMs: sum._sum.cpuMs ?? 0, requests: sum._sum.requests ?? 0 };
}

/** The saving step for the usage so far (looked up at most every 10 minutes per server instance). */
export async function currentSavingLevel(prisma: PrismaClient): Promise<SavingLevel> {
  if (!meterEnabled()) return 0;
  const s = state();
  if (Date.now() - s.levelAt < LEVEL_CACHE_MS) return s.level;
  s.levelAt = Date.now();
  try {
    s.level = savingLevel((await usageLast30Days(prisma)).cpuMs, budgetMs());
  } catch (err) {
    console.error("[usage] couldn't read", err);
  }
  return s.level;
}
