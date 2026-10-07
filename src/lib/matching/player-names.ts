/**
 * Player names are stored as "Surname F." (e.g. "Koczyba M."), the way
 * Cage Capital writes them. Bet slips and typed names often have the full
 * name ("Mariusz Koczyba"); this turns them into the same short form so
 * duplicates, tailing and league guessing all match up.
 */

/** "M", "M.", "J.H.", "J.-P." */
const INITIALS = /^(?:\p{L}\.-?){1,3}$|^\p{L}$/u;
/** Lowercase name particles that belong to the surname ("van der Berg"). */
const PARTICLES = new Set(["van", "von", "der", "den", "de", "da", "di", "del", "della", "dos", "du", "la", "le"]);

const isAllCaps = (t: string) => t.length >= 2 && t === t.toLocaleUpperCase() && t !== t.toLocaleLowerCase();
const initial = (t: string) => `${t.charAt(0).toLocaleUpperCase()}.`;
/** "KOCZYBA" / "koczyba" -> "Koczyba"; "Koczyba" and "McDonald" stay as they are. */
const tidyCase = (t: string) =>
  t === t.toLocaleUpperCase() || t === t.toLocaleLowerCase()
    ? t.toLocaleLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase())
    : t;

export function shortPlayerName(name: string): string {
  const tokens = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length < 2) return tokens.join(" ");
  const last = tokens[tokens.length - 1];
  // Already short: "Sobel A." ("Sobel A" gets its dot).
  if (INITIALS.test(last)) return [...tokens.slice(0, -1), /^\p{L}$/u.test(last) ? initial(last) : last].join(" ");
  // "A. Sobel"
  if (INITIALS.test(tokens[0])) return `${tokens.slice(1).join(" ")} ${initial(tokens[0])}`;
  // "SOBEL Adam": the surname in capitals comes first.
  const capsLead = tokens.findIndex((t) => !isAllCaps(t));
  if (capsLead > 0) return `${tokens.slice(0, capsLead).map(tidyCase).join(" ")} ${initial(tokens[capsLead])}`;
  // "Mariusz Koczyba" -> "Koczyba M." (middle names dropped, "van der" kept).
  let start = tokens.length - 1;
  while (start > 1 && PARTICLES.has(tokens[start - 1].toLocaleLowerCase())) start--;
  return `${tokens.slice(start).map((t) => (PARTICLES.has(t.toLocaleLowerCase()) ? t.toLocaleLowerCase() : tidyCase(t))).join(" ")} ${initial(tokens[0])}`;
}
