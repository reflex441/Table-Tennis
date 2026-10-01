import { db } from "@/lib/db";
import { handle, jsonError } from "@/lib/api";

export const GET = handle(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const row = await db().screenshot.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!row) return jsonError(404, "not_found", "Screenshot not found.");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
