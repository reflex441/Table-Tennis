import { randomInt } from "node:crypto";

/** Invite key format: making one, and reading one typed by hand. */

/** No 0/O or 1/I, so a key read out or typed by hand can't be mixed up. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. "TT-7KQ2-M9XP-4HDR" (12 random characters: about 60 bits). */
export function newInviteCode(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `TT-${group()}-${group()}-${group()}`;
}

/** "tt 7kq2 m9xp 4hdr" / "7KQ2M9XP4HDR" -> "TT-7KQ2-M9XP-4HDR". */
export function normalizeInviteCode(text: string): string {
  const raw = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.length === 14 && raw.startsWith("TT") ? raw.slice(2) : raw;
  return body.length === 12 ? `TT-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}` : text.trim().toUpperCase();
}
