import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AlarmStatus } from "@/generated/prisma/enums";
import { SECTION_STATUSES, type Section } from "./schedule";
import { matchInclude, toMatchDTO } from "./service";
import type { MatchDTO } from "@/lib/types";

export async function listMatches(prisma: PrismaClient, userId: string, section: Section | null): Promise<MatchDTO[]> {
  const where: Prisma.MatchWhereInput = !section
    ? { userId }
    : section === "pending"
      ? { userId, bet: { is: { result: "PENDING" } } }
      : { userId, alarm: { is: { status: { in: SECTION_STATUSES[section] as AlarmStatus[] } } }, NOT: { bet: { is: { result: "PENDING" } } } };
  const order = section === "upcoming" || section === "triggered" ? "asc" : "desc";
  const rows = await prisma.match.findMany({
    where,
    include: matchInclude,
    orderBy: { startsAt: order },
    take: 200,
  });
  return rows.map(toMatchDTO);
}

export async function getMatch(prisma: PrismaClient, userId: string, id: string): Promise<MatchDTO | null> {
  const row = await prisma.match.findFirst({ where: { id, userId }, include: matchInclude });
  return row ? toMatchDTO(row) : null;
}
