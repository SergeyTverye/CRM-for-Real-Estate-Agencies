import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { parseInput, skipTake, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { clientScope, needScope, dealScope, communicationScope, showingScope, offerScope, leadRequestScope } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { loadAccessibleClient } from "./client-service";

export const clientFiltersSchema = zPagination.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["active", "inactive", "archived", "all"]).default("all"),
  responsibleUserId: zUuid.optional(),
  hasActiveNeed: z.enum(["yes", "no"]).optional(),
  sort: z.enum(["name", "created_desc", "updated_desc"]).default("updated_desc"),
});

export interface ClientListItem {
  id: string;
  displayName: string;
  clientKind: string;
  status: string;
  primaryContact: string | null;
  responsible: { id: string; displayName: string };
  activeNeeds: number;
  nextAction: { title: string; dueAt: Date } | null;
  lastActivityAt: Date | null;
  updatedAt: Date;
}

/** Поиск по имени, нормализованному телефону/e-mail (FR-02). */
export function clientSearchWhere(q: string): Prisma.ClientWhereInput {
  const digits = q.replace(/\D/g, "");
  const or: Prisma.ClientWhereInput[] = [
    { displayName: { contains: q, mode: "insensitive" } },
    { contacts: { some: { rawValue: { contains: q, mode: "insensitive" } } } },
    { contactPersons: { some: { fullName: { contains: q, mode: "insensitive" } } } },
  ];
  if (digits.length >= 4) or.push({ contacts: { some: { normalizedValue: { contains: digits } } } });
  if (q.includes("@")) or.push({ contacts: { some: { normalizedValue: { contains: q.toLowerCase() } } } });
  return { OR: or };
}

export async function listClients(actor: Actor, raw: unknown): Promise<Page<ClientListItem>> {
  const f = parseInput(clientFiltersSchema, raw);
  const and: Prisma.ClientWhereInput[] = [clientScope(actor)];
  if (f.status !== "all") and.push({ status: f.status });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.q) and.push(clientSearchWhere(f.q));
  if (f.hasActiveNeed === "yes") and.push({ needs: { some: { status: { in: ["active", "paused"] } } } });
  if (f.hasActiveNeed === "no") and.push({ needs: { none: { status: { in: ["active", "paused"] } } } });
  const where: Prisma.ClientWhereInput = { AND: and };
  const orderBy: Prisma.ClientOrderByWithRelationInput =
    f.sort === "name" ? { displayName: "asc" } : f.sort === "created_desc" ? { createdAt: "desc" } : { updatedAt: "desc" };
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      orderBy,
      ...skipTake(f),
      select: {
        id: true,
        displayName: true,
        clientKind: true,
        status: true,
        updatedAt: true,
        responsible: { select: { id: true, displayName: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { rawValue: true } },
        _count: { select: { needs: { where: { status: { in: ["active", "paused"] } } } } },
        taskLinks: {
          where: { task: { status: { in: [...OPEN_TASK_STATUSES] } } },
          orderBy: { task: { dueAt: "asc" } },
          take: 1,
          select: { task: { select: { title: true, dueAt: true } } },
        },
        communications: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
        leadRequests: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    }),
    db.client.count({ where }),
  ]);
  return {
    items: rows.map((r) => {
      const dates = [r.communications[0]?.occurredAt, r.leadRequests[0]?.occurredAt].filter(Boolean) as Date[];
      return {
        id: r.id,
        displayName: r.displayName,
        clientKind: r.clientKind,
        status: r.status,
        primaryContact: r.contacts[0]?.rawValue ?? null,
        responsible: r.responsible,
        activeNeeds: r._count.needs,
        nextAction: r.taskLinks[0]?.task ?? null,
        lastActivityAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
        updatedAt: r.updatedAt,
      };
    }),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

/** Клиенты для выбора в формах (только доступные; короткий список). */
export async function pickClients(actor: Actor, q: string | undefined, take = 20) {
  return db.client.findMany({
    where: { AND: [clientScope(actor), { status: { not: "archived" } }, q ? clientSearchWhere(q) : {}] },
    select: { id: true, displayName: true, contacts: { take: 1, orderBy: { isPrimary: "desc" }, select: { rawValue: true } } },
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export async function getClientCard(actor: Actor, clientId: string) {
  await loadAccessibleClient(db, actor, clientId);
  const client = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], include: { contactPerson: { select: { fullName: true } } } },
      contactPersons: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      needs: {
        orderBy: [{ status: "asc" }, { openedAt: "desc" }],
        select: {
          id: true,
          operationType: true,
          propertyType: true,
          stage: true,
          status: true,
          budgetMin: true,
          budgetMax: true,
          district: true,
          openedAt: true,
          closedAt: true,
          responsible: { select: { displayName: true } },
        },
      },
      dealParties: {
        where: { deal: dealScope(actor) },
        select: { partyRole: true, deal: { select: { id: true, status: true, openedAt: true, dealPrice: true, property: { select: { addressText: true } } } } },
      },
      ownerships: { select: { ownerRole: true, property: { select: { id: true, addressText: true, status: true } } } },
      agreements: {
        where: { archivedAt: null },
        select: { id: true, agreementType: true, status: true, validUntil: true, agreementNumber: true },
      },
    },
  });
  return client;
}

export type ClientCard = Awaited<ReturnType<typeof getClientCard>>;

export interface TimelineEvent {
  at: Date;
  kind: "request" | "communication" | "match" | "showing" | "stage" | "task" | "deal" | "offer" | "need";
  title: string;
  details?: string | null;
  href?: string | null;
  author?: string | null;
}

/**
 * Единая лента истории клиента (ТЗ 37.5): обращения, коммуникации, предложения объектов,
 * показы, смены этапов, задачи и сделки. AuditLog в ленту не подмешивается.
 */
export async function getClientTimeline(actor: Actor, clientId: string, take = 200): Promise<TimelineEvent[]> {
  await loadAccessibleClient(db, actor, clientId);
  const needWhere = { clientId, ...needScope(actor) };
  const [requests, comms, needs, matches, showings, stages, tasks, deals, offers] = await Promise.all([
    db.leadRequest.findMany({ where: { clientId, ...leadRequestScope(actor) }, include: { creator: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take }),
    db.communication.findMany({ where: { clientId, ...communicationScope(actor) }, include: { author: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take }),
    db.clientNeed.findMany({ where: needWhere, include: { creator: { select: { displayName: true } } }, orderBy: { openedAt: "desc" }, take }),
    db.needPropertyMatch.findMany({
      where: { need: needWhere },
      include: { property: { select: { addressText: true } }, creator: { select: { displayName: true } } },
      orderBy: { offeredAt: "desc" },
      take,
    }),
    db.showing.findMany({ where: { need: needWhere, ...showingScope(actor) }, include: { property: { select: { addressText: true } } }, orderBy: { scheduledAt: "desc" }, take }),
    db.needStageHistory.findMany({ where: { need: needWhere }, include: { changer: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take }),
    db.task.findMany({
      where: { clientLinks: { some: { clientId } } },
      include: { responsible: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.deal.findMany({ where: { parties: { some: { clientId } }, ...dealScope(actor) }, include: { property: { select: { addressText: true } } }, orderBy: { openedAt: "desc" }, take }),
    db.commercialOffer.findMany({ where: { need: needWhere, ...offerScope(actor) }, orderBy: { createdAt: "desc" }, take }),
  ]);
  const ev: TimelineEvent[] = [];
  for (const r of requests) ev.push({ at: r.occurredAt, kind: "request", title: `Обращение (${r.channelCode}, ${r.sourceCode})`, details: r.summary, href: `/requests/${r.id}`, author: r.creator.displayName });
  for (const c of comms) ev.push({ at: c.occurredAt, kind: "communication", title: `Коммуникация: ${c.communicationType}`, details: c.comment, author: c.author.displayName });
  for (const n of needs) ev.push({ at: n.openedAt, kind: "need", title: "Открыта потребность", details: `${n.operationType} / ${n.propertyType}`, href: `/needs/${n.id}`, author: n.creator.displayName });
  for (const m of matches) ev.push({ at: m.offeredAt, kind: "match", title: `Предложен объект: ${m.property.addressText}`, details: m.comment, href: `/needs/${m.clientNeedId}`, author: m.creator.displayName });
  for (const s of showings)
    ev.push({ at: s.occurredAt ?? s.scheduledAt, kind: "showing", title: `Показ: ${s.property.addressText}`, details: [s.status, s.resultCode, s.comment].filter(Boolean).join(" · "), href: `/showings/${s.id}` });
  for (const h of stages)
    ev.push({
      at: h.occurredAt,
      kind: "stage",
      title: h.fromStatus !== h.toStatus && h.toStatus ? `Статус потребности: ${h.toStatus}` : `Этап потребности: ${h.toStage}`,
      details: [h.reasonCode, h.comment].filter(Boolean).join(" · "),
      href: `/needs/${h.clientNeedId}`,
      author: h.changer.displayName,
    });
  for (const t of tasks) {
    ev.push({ at: t.createdAt, kind: "task", title: `Задача: ${t.title}`, details: `срок ${t.dueAt.toISOString()}`, href: `/tasks/${t.id}`, author: t.responsible.displayName });
    if (t.completedAt) ev.push({ at: t.completedAt, kind: "task", title: `Выполнено: ${t.title}`, details: t.resultComment, href: `/tasks/${t.id}` });
  }
  for (const d of deals) ev.push({ at: d.openedAt, kind: "deal", title: `Сделка: ${d.property.addressText}`, details: d.status, href: `/deals/${d.id}` });
  for (const o of offers) ev.push({ at: o.sentAt ?? o.createdAt, kind: "offer", title: `Коммерческое предложение: ${o.title ?? ""}`.trim(), details: o.status, href: `/offers/${o.id}` });
  return ev.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}
