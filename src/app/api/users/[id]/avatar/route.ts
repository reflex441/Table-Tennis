import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";

/** An account's profile picture (signed-in users only). */
export const GET = handle(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUserId();
  const { id } = await ctx.params;
  const row = await db().user.findUnique({ where: { id }, select: { avatar: true, avatarMime: true } });
  if (!row?.avatar || !row.avatarMime) return jsonError(404, "not_found", "No picture.");
  return new Response(new Uint8Array(row.avatar), {
    headers: {
      "Content-Type": row.avatarMime,
      // URLs are versioned (?v=), so the picture can be cached.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
