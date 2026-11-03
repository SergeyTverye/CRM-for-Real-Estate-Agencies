import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { parseInput, skipTake, zCode, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { needScope, showingScope, communicationScope, offerScope, canSeeClient } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { loadAccessibleNeed } from "./need-service";

export const needFiltersSchema = zPagination.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["active", "paused", "success", "closed", "open", "all"]).default("open"),
  stage: zCode("needStage").optional(),
  operationType: z.string().max(50).optional(),
  propertyType: z.string().max(50).optional(),
  responsibleUserId: zUuid.optional(),
  clientId: zUuid.optional(),
  withoutNextAction: z.enum(["yes"]).optional(),
  stale: z.enum(["yes"]).optional(),
});

/** Условие «без движения» (ТЗ 40.6): нет Communication/Match/Showing/StageHistory/завершённой Task за период. */
export function staleNeedWhere(since: Date): Prisma.ClientNeedWhereInput {
  return {
    status: "active",
    openedAt: { lt: since },
    communications: { none: { occurredAt: { gte: since } } },
    matches: { none: { offeredAt: { gte: since } } },
    showings: { none: { OR: [{ createdAt: { gte: since } }, { occurredAt: { gte: since } }] } },
    stageHistory: { none: { occurredAt: { gte: since } } },
    taskLinks: { none: { task: { completedAt: { gte: since } } } },
  };
}

export async function listNeeds(actor: Actor, raw: unknown) {
  const f = parseInput(needFiltersSchema, raw);
  const and: Prisma.ClientNeedWhereInput[] = [needScope(actor)];
  if (f.status === "open") and.push({ status: { in: ["active", "paused"] } });
  else if (f.status !== "all") and.push({ status: f.status });
  if (f.stage) and.push({ stage: f.stage });
  if (f.operationType) and.push({ operationType: f.operationType });
  if (f.propertyType) and.push({ propertyType: f.propertyType });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.q) and.push({ OR: [{ client: { displayName: { contains: f.q, mode: "insensitive" } } }, { district: { contains: f.q, mode: "insensitive" } }, { locationText: { contains: f.q, mode: "insensitive" } }] });
  if (f.withoutNextAction) and.push({ status: { in: ["active", "paused"] }, taskLinks: { none: { task: { status: { in: [...OPEN_TASK_STATUSES] } } } } });
  if (f.stale) and.push(staleNeedWhere(new Date(Date.now() - getConfig().NEED_INACTIVITY_DAYS * 86_400_000)));
  const where: Prisma.ClientNeedWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.clientNeed.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      ...skipTake(f),
      include: {
        client: { select: { id: true, displayName: true, responsibleUserId: true } },
        responsible: { select: { id: true, displayName: true } },
        taskLinks: {
          where: { task: { status: { in: [...OPEN_TASK_STATUSES] } } },
          orderBy: { task: { dueAt: "asc" } },
          take: 1,
          select: { task: { select: { id: true, title: true, dueAt: true } } },
        },
        _count: { select: { matches: true, showings: true } },
      },
    }),
    db.clientNeed.count({ where }),
  ]);
  const page: Page<(typeof rows)[number] & { clientVisible: boolean }> = {
    items: rows.map((r) => ({ ...r, clientVisible: canSeeClient(actor, r.client) })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
  return page;
}

export async function getNeedCard(actor: Actor, needId: string) {
  await loadAccessibleNeed(db, actor, needId);
  const need = await db.clientNeed.findUniqueOrThrow({
    where: { id: needId },
    include: {
      client: {
        select: {
          id: true,
          displayName: true,
          status: true,
          responsibleUserId: true,
          contacts: { orderBy: { isPrimary: "desc" }, take: 2, select: { rawValue: true, contactType: true } },
        },
      },
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      matches: {
        orderBy: { offeredAt: "desc" },
        include: {
          property: { select: { id: true, addressText: true, price: true, area: true, status: true, propertyType: true } },
          creator: { select: { displayName: true } },
        },
      },
      showings: {
        where: showingScope(actor),
        orderBy: { scheduledAt: "desc" },
        include: { property: { select: { id: true, addressText: true } }, responsible: { select: { displayName: true } } },
      },
      stageHistory: { orderBy: { occurredAt: "desc" }, include: { changer: { select: { displayName: true } } } },
      communications: { where: communicationScope(actor), orderBy: { occurredAt: "desc" }, take: 50, include: { author: { select: { displayName: true } } } },
      commercialOffers: { where: offerScope(actor), orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, sentAt: true, createdAt: true } },
    },
  });
  const tasks = await listTasksLinkedTo(actor, { needId }, { includeClosed: true, take: 50 });
  return { need, clientVisible: canSeeClient(actor, need.client), tasks };
}

export type NeedCard = Awaited<ReturnType<typeof getNeedCard>>;
