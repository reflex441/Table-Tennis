import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, jsonError, parseJson } from "@/lib/api";
import { screenshotSelect, toScreenshotDTO } from "@/lib/screenshot-dto";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const row = await db().screenshot.findUnique({ where: { id }, select: screenshotSelect });
  if (!row) return jsonError(404, "not_found", "Screenshot not found.");
  return NextResponse.json({ screenshot: toScreenshotDTO(row) });
});

const patchSchema = z.object({
  /** Manually confirmed capture time (ISO) or null to clear it. */
  capturedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseJson(request, patchSchema);
  const exists = await db().screenshot.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError(404, "not_found", "Screenshot not found.");
  const row = await db().screenshot.update({
    where: { id },
    data: body.capturedAt
      ? { capturedAt: new Date(body.capturedAt), capturedAtSource: "MANUAL" }
      : { capturedAt: null, capturedAtSource: "NONE" },
    select: screenshotSelect,
  });
  return NextResponse.json({ screenshot: toScreenshotDTO(row) });
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const res = await db().screenshot.deleteMany({ where: { id } });
  if (!res.count) return jsonError(404, "not_found", "Screenshot not found.");
  return new NextResponse(null, { status: 204 });
});
