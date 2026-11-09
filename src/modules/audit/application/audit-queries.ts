import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, startOfDayInTz } from "@/shared/time";
import { ForbiddenError } from "@/shared/errors";
import { parseInput, skipTake, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";



const dateParam = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Некорректная дата");

export const auditFiltersSchema = zPagination.extend({
  entityType: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  actorUserId: zUuid.optional(),
  entityId: zUuid.optional(),
  
  from: dateParam.optional(),
  to: dateParam.optional(),
});

export type AuditFilters = z.input<typeof auditFiltersSchema>;

export interface AuditRow {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; displayName: string; login: string } | null;
  before: unknown;
  after: unknown;
  correlationId: string | null;
}


function localDayStart(date: string, timeZone: string): Date {
  return startOfDayInTz(new Date(`${date}T12:00:00.000Z`), timeZone);
}

export async function listAuditLog(actor: Actor, raw: unknown): Promise<Page<AuditRow>> {
  if (!isManager(actor)) throw new ForbiddenError();
  const f = parseInput(auditFiltersSchema, raw);
  const tz = getConfig().APP_TIMEZONE;
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.entityType) and.push({ entityType: f.entityType });
  
  if (f.action) and.push(f.action.endsWith(".") ? { action: { startsWith: f.action } } : { action: f.action });
  if (f.actorUserId) and.push({ actorUserId: f.actorUserId });
  if (f.entityId) and.push({ entityId: f.entityId });
  if (f.from) and.push({ occurredAt: { gte: localDayStart(f.from, tz) } });
  if (f.to) and.push({ occurredAt: { lt: startOfDayInTz(addDays(localDayStart(f.to, tz), 1.5), tz) } });
  const where: Prisma.AuditLogWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: { actor: { select: { id: true, displayName: true, login: true } } },
      ...skipTake(f),
    }),
    db.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actor,
      before: r.beforeJsonb,
      after: r.afterJsonb,
      correlationId: r.correlationId,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}


export async function listAuditFacets(actor: Actor): Promise<{ entityTypes: string[]; actions: string[] }> {
  if (!isManager(actor)) throw new ForbiddenError();
  const [types, actions] = await Promise.all([
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" }, take: 200 }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 500 }),
  ]);
  return { entityTypes: types.map((t) => t.entityType), actions: actions.map((a) => a.action) };
}
