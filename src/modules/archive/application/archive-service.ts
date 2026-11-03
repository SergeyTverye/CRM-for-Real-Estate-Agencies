import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zDateOnly, zPagination } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";

/**
 * HistoricalDealArchive (FR-18, ТЗ 19.5, 29.10): изолированный read-only архив прошлых сделок.
 * Доступ — только руководителю; паспортных и регистрационных полей в модели нет.
 */
function requireManager(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError("Исторический архив доступен только руководителю");
}

export const archiveFiltersSchema = zPagination.extend({
  q: z.string().trim().max(200).optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
  linked: z.enum(["yes", "no"]).optional(),
});

export async function listArchive(actor: Actor, raw: unknown) {
  requireManager(actor);
  const f = parseInput(archiveFiltersSchema, raw);
  const and: Prisma.HistoricalDealArchiveWhereInput[] = [];
  if (f.q)
    and.push({
      OR: [
        { participantName: { contains: f.q, mode: "insensitive" } },
        { objectText: { contains: f.q, mode: "insensitive" } },
        { contactPhone: { contains: f.q.replace(/\D/g, "") || f.q } },
        { realtorText: { contains: f.q, mode: "insensitive" } },
      ],
    });
  if (f.from) and.push({ dealDate: { gte: f.from } });
  if (f.to) and.push({ dealDate: { lte: f.to } });
  if (f.linked === "yes") and.push({ clientId: { not: null } });
  if (f.linked === "no") and.push({ clientId: null });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    db.historicalDealArchive.findMany({ where, orderBy: [{ dealDate: { sort: "desc", nulls: "last" } }], ...skipTake(f), include: { client: { select: { id: true, displayName: true } } } }),
    db.historicalDealArchive.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize };
}

export async function getArchiveRecord(actor: Actor, id: string) {
  assertRecordId(id);
  requireManager(actor);
  const r = await db.historicalDealArchive.findUnique({ where: { id }, include: { client: { select: { id: true, displayName: true } }, importJob: { select: { id: true, sourceFilename: true } } } });
  if (!r) throw new NotFoundError();
  return r;
}
