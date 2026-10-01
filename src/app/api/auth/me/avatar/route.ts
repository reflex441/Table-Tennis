import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError } from "@/lib/api";
import { MAX_AVATAR_BYTES, setAvatar, toPublicUser } from "@/lib/auth/accounts";
import { detectImageType } from "@/lib/screenshots";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Upload a new profile picture (multipart field "file"). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_form", "Expected multipart/form-data with a 'file' field.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "missing_file", "No picture uploaded.");
  if (file.size > MAX_AVATAR_BYTES) return jsonError(413, "file_too_large", "The picture is too big (max 512 KB).");
  const data = Buffer.from(await file.arrayBuffer());
  const mime = detectImageType(data);
  if (!mime || !ALLOWED.has(mime)) return jsonError(415, "unsupported_type", "Use a PNG, JPEG or WebP picture.");
  const user = await setAvatar(db(), userId, { data, mime });
  return NextResponse.json({ user: toPublicUser(user) });
});

/** Remove your profile picture. */
export const DELETE = handle(async () => {
  const user = await setAvatar(db(), await requireUserId(), null);
  return NextResponse.json({ user: toPublicUser(user) });
});
