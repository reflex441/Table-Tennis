import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, parseJson } from "@/lib/api";
import { createMatchesSchema } from "@/lib/validation/match";
import { createMatchWithAlarm, toMatchDTO } from "@/lib/alarms/service";
import { listMatches } from "@/lib/alarms/queries";
import { wakeScheduler } from "@/lib/scheduler/runner";
import type { Section } from "@/lib/alarms/schedule";

const SECTIONS = new Set(["upcoming", "triggered", "completed", "cancelled", "all"]);

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const section = url.searchParams.get("section") ?? "all";
  const matches = await listMatches(db(), await requireUserId(), SECTIONS.has(section) && section !== "all" ? (section as Section) : null);
  return NextResponse.json({ matches });
});

/**
 * Create matches + alarms from confirmed review results. Each item is handled
 * independently so one duplicate doesn't block the rest.
 */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  const body = await parseJson(request, createMatchesSchema);
  const prisma = db();
  const results = [];
  for (const [index, input] of body.matches.entries()) {
    const outcome = await createMatchWithAlarm(prisma, userId, input);
    if (outcome.status === "created") {
      results.push({ index, status: "created" as const, immediate: outcome.immediate, match: toMatchDTO(outcome.match) });
    } else {
      results.push({ index, ...outcome });
    }
  }
  if (results.some((r) => r.status === "created")) wakeScheduler();
  const created = results.filter((r) => r.status === "created").length;
  return NextResponse.json({ results, created }, { status: created ? 201 : 200 });
});
