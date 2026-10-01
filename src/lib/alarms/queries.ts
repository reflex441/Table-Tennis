import type { PrismaClient } from "@/generated/prisma/client";
import type { AlarmStatus } from "@/generated/prisma/enums";
import { SECTION_STATUSES, type Section } from "./schedule";
import { matchInclude, toMatchDTO } from "./service";
import type { MatchDTO } from "@/lib/types";

export async function listMatches(prisma: PrismaClient, section: Section | null): Promise<MatchDTO[]> {
  const where = section ? { alarm: { status: { in: SECTION_STATUSES[section] as AlarmStatus[] } } } : {};
  const order = section === "upcoming" || section === "triggered" ? "asc" : "desc";
  const rows = await prisma.match.findMany({
    where,
    include: matchInclude,
    orderBy: { startsAt: order },
    take: 200,
  });
  return rows.map(toMatchDTO);
}

export async function getMatch(prisma: PrismaClient, id: string): Promise<MatchDTO | null> {
  const row = await prisma.match.findUnique({ where: { id }, include: matchInclude });
  return row ? toMatchDTO(row) : null;
}
