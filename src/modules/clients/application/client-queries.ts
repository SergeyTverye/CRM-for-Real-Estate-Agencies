import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { parseInput, skipTake, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { clientScope, dealScope, communicationScope, showingScope, offerScope, taskScope } from "@/modules/access/domain/scopes";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { labelOf } from "@/shared/codebook";
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

/** Клиенты для выбора в формах (только доступные. короткий список). */
export async function pickClients(actor: Actor, q: string | undefined, take = 20) {
  const query = parseInput(z.string().trim().max(120).default(""), q);
  const limit = parseInput(z.number().int().min(1).max(20), take);
  return db.client.findMany({
    where: { AND: [clientScope(actor), { status: { not: "archived" } }, query ? clientSearchWhere(query) : {}] },
    select: { id: true, displayName: true, contacts: { take: 1, orderBy: { isPrimary: "desc" }, select: { rawValue: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
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

export async function getClientRecentInteractions(actor: Actor, clientId: string): Promise<TimelineEvent[]> {
  await loadAccessibleClient(db, actor, clientId);
  const [comms, showings, offers, tasks] = await Promise.all([
    db.communication.findMany({ where: { clientId, AND: [communicationScope(actor)] }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, occurredAt: true, communicationType: true, comment: true, author: { select: { displayName: true } } } }),
    db.showing.findMany({ where: { need: { clientId }, AND: [showingScope(actor)] }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, updatedAt: true, scheduledAt: true, status: true, property: { select: { addressText: true } } } }),
    db.commercialOffer.findMany({ where: { need: { clientId }, AND: [offerScope(actor)] }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, title: true, updatedAt: true, status: true } }),
    db.task.findMany({ where: { AND: [taskScope(actor), safeTaskTextScope(actor), clientTaskContext(clientId)], NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, title: true, updatedAt: true, status: true, responsible: { select: { displayName: true } } } }),
  ]);
  const events: TimelineEvent[] = [
    ...comms.map(c => ({ at: c.occurredAt, kind: "communication" as const, title: labelOf("communicationType", c.communicationType), details: c.comment, author: c.author.displayName, href: `/clients/${clientId}?tab=history` })),
    ...showings.map(s => ({ at: s.updatedAt, kind: "showing" as const, title: `Показ: ${s.property.addressText}`, details: labelOf("showingStatus", s.status), href: `/showings/${s.id}` })),
    ...offers.map(o => ({ at: o.updatedAt, kind: "offer" as const, title: `КП: ${o.title ?? "без названия"}`, details: labelOf("offerStatus", o.status), href: `/offers/${o.id}` })),
    ...tasks.map(t => ({ at: t.updatedAt, kind: "task" as const, title: t.title, details: labelOf("taskStatus", t.status), author: t.responsible.displayName, href: `/tasks/${t.id}` })),
  ];
  return events.sort((a, b) => +b.at - +a.at || (a.href ?? "").localeCompare(b.href ?? "")).slice(0, 5);
}

export function clientTaskContext(clientId: string): Prisma.TaskWhereInput {
  return { OR: [
    { clientLinks: { some: { clientId } } }, { needLinks: { some: { need: { clientId } } } },
    { showingLinks: { some: { showing: { need: { clientId } } } } },
    { offerLinks: { some: { offer: { need: { clientId } } } } },
    { agreementLinks: { some: { agreement: { clientId } } } },
    { dealLinks: { some: { deal: { parties: { some: { clientId } } } } } },
  ] };
}

export async function getClientTimeline(actor: Actor, clientId: string, take = 100) {
  const { getClientTimelinePage } = await import("./timeline-service");
  return (await getClientTimelinePage(actor, clientId, { pageSize: Math.min(100, Math.max(1, take)) })).items;
}
