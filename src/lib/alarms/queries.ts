import type { PrismaClient } from "@/generated/prisma/client";
import { sectionFor, type Section } from "./schedule";
import { matchInclude, toMatchDTO } from "./service";
import type { MatchDTO } from "@/lib/types";

/** The user's matches, optionally only one dashboard section (see sectionFor). */
export async function listMatches(prisma: PrismaClient, userId: string, section: Section | null): Promise<MatchDTO[]> {
  const order = section === "upcoming" || section === "triggered" ? "asc" : "desc";
  const rows = await prisma.match.findMany({
    where: { userId },
    include: matchInclude,
    orderBy: { startsAt: order },
    take: section ? 1000 : 200,
  });
  const all = rows.map(toMatchDTO);
  return section ? all.filter((m) => sectionFor(m) === section).slice(0, 200) : all;
}

export async function getMatch(prisma: PrismaClient, userId: string, id: string): Promise<MatchDTO | null> {
  const row = await prisma.match.findFirst({ where: { id, userId }, include: matchInclude });
  return row ? toMatchDTO(row) : null;
}
