import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, startOfDayInTz, todayAsDateOnly } from "@/shared/time";
import { NotFoundError } from "@/shared/errors";
import { parseInput, skipTake, zCode, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, canSeeNeed, needScope, showingScope, agreementScope, offerScope, taskScope } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES, todayGroupOf, type TodayGroup } from "../domain/task-rules";

export interface TaskLinkView {
  kind: "client" | "need" | "property" | "showing" | "deal" | "advertisement" | "agreement" | "offer";
  id: string;
  label: string;
  href: string | null;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  taskSubtypeCode: string | null;
  dueAt: Date;
  status: string;
  priority: string;
  responsible: { id: string; displayName: string };
  createdBy: string;
  recurrenceKind: string;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  parentTaskId: string | null;
  completedAt: Date | null;
  resultComment: string | null;
  overdue: boolean;
  links: TaskLinkView[];
  updatedAt: Date;
}

export const taskInclude = {
  responsible: { select: { id: true, displayName: true } },
  clientLinks: { select: { client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
  needLinks: {
    select: {
      need: {
        select: {
          id: true,
          operationType: true,
          propertyType: true,
          responsibleUserId: true,
          client: { select: { displayName: true, responsibleUserId: true } },
        },
      },
    },
  },
  propertyLinks: { select: { property: { select: { id: true, addressText: true } } } },
  showingLinks: { select: { showing: { select: { id: true, scheduledAt: true, property: { select: { addressText: true } } } } } },
  dealLinks: { select: { deal: { select: { id: true, property: { select: { addressText: true } } } } } },
  advertisementLinks: { select: { advertisement: { select: { id: true, platformCode: true, property: { select: { addressText: true } } } } } },
  agreementLinks: { select: { agreement: { select: { id: true, agreementType: true, agreementNumber: true } } } },
  offerLinks: { select: { offer: { select: { id: true, title: true } } } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function toTaskView(actor: Actor, t: TaskRow, now = new Date()): TaskView {
  const links: TaskLinkView[] = [];
  for (const { client } of t.clientLinks) {
    const ok = canSeeClient(actor, client);
    links.push({ kind: "client", id: client.id, label: ok ? client.displayName : "Клиент (нет доступа)", href: ok ? `/clients/${client.id}` : null });
  }
  for (const { need } of t.needLinks) {
    const ok = canSeeNeed(actor, need);
    links.push({
      kind: "need",
      id: need.id,
      label: ok ? `Потребность: ${need.client.displayName}` : "Потребность (нет доступа)",
      href: ok ? `/needs/${need.id}` : null,
    });
  }
  for (const { property } of t.propertyLinks) links.push({ kind: "property", id: property.id, label: property.addressText, href: `/properties/${property.id}` });
  for (const { showing } of t.showingLinks)
    links.push({ kind: "showing", id: showing.id, label: `Показ: ${showing.property.addressText}`, href: `/showings/${showing.id}` });
  for (const { deal } of t.dealLinks) links.push({ kind: "deal", id: deal.id, label: `Сделка: ${deal.property.addressText}`, href: `/deals/${deal.id}` });
  for (const { advertisement: a } of t.advertisementLinks)
    links.push({ kind: "advertisement", id: a.id, label: `Реклама: ${a.property.addressText}`, href: `/advertisements/${a.id}` });
  for (const { agreement: a } of t.agreementLinks)
    links.push({ kind: "agreement", id: a.id, label: `Договор ${a.agreementNumber ?? ""}`.trim(), href: `/agreements/${a.id}` });
  for (const { offer } of t.offerLinks) links.push({ kind: "offer", id: offer.id, label: `КП: ${offer.title ?? "без названия"}`, href: `/offers/${offer.id}` });
  const open = (OPEN_TASK_STATUSES as readonly string[]).includes(t.status);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    taskType: t.taskType,
    taskSubtypeCode: t.taskSubtypeCode,
    dueAt: t.dueAt,
    status: t.status,
    priority: t.priority,
    responsible: t.responsible,
    createdBy: t.createdBy,
    recurrenceKind: t.recurrenceKind,
    recurrenceInterval: t.recurrenceInterval,
    recurrenceUntil: t.recurrenceUntil,
    parentTaskId: t.parentTaskId,
    completedAt: t.completedAt,
    resultComment: t.resultComment,
    overdue: open && t.dueAt.getTime() < now.getTime(),
    links,
    updatedAt: t.updatedAt,
  };
}

function dayBounds(now = new Date()) {
  const tz = getConfig().APP_TIMEZONE;
  const startToday = startOfDayInTz(now, tz);
  const startTomorrow = startOfDayInTz(addDays(startToday, 1.5), tz);
  const weekEnd = startOfDayInTz(addDays(startToday, 7.5), tz);
  return { startToday, startTomorrow, weekEnd };
}

export const taskFiltersSchema = zPagination.extend({
  view: z.enum(["mine", "overdue", "today", "week", "all"]).default("mine"),
  status: z.enum(["open", "completed", "cancelled", "all"]).default("open"),
  taskType: zCode("taskType").optional(),
  responsibleUserId: zUuid.optional(),
  clientId: zUuid.optional(),
  needId: zUuid.optional(),
  dealId: zUuid.optional(),
  propertyId: zUuid.optional(),
  q: z.string().trim().max(200).optional(),
});

export type TaskFilters = z.input<typeof taskFiltersSchema>;

export async function listTasks(actor: Actor, rawFilters: unknown): Promise<Page<TaskView>> {
  const f = parseInput(taskFiltersSchema, rawFilters);
  const now = new Date();
  const { startTomorrow, weekEnd } = dayBounds(now);
  const and: Prisma.TaskWhereInput[] = [taskScope(actor)];
  const managerAll = isManager(actor) && (f.view === "all" || f.responsibleUserId);
  if (!managerAll) and.push({ responsibleUserId: actor.userId });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.status === "open" || ["overdue", "today", "week"].includes(f.view)) and.push({ status: { in: [...OPEN_TASK_STATUSES] } });
  else if (f.status !== "all") and.push({ status: f.status });
  if (f.view === "overdue") and.push({ dueAt: { lt: now } });
  if (f.view === "today") and.push({ dueAt: { gte: now, lt: startTomorrow } });
  if (f.view === "week") and.push({ dueAt: { gte: now, lt: weekEnd } });
  if (f.taskType) and.push({ taskType: f.taskType });
  if (f.clientId) and.push({ clientLinks: { some: { clientId: f.clientId } } });
  if (f.needId) and.push({ needLinks: { some: { clientNeedId: f.needId } } });
  if (f.dealId) and.push({ dealLinks: { some: { dealId: f.dealId } } });
  if (f.propertyId) and.push({ propertyLinks: { some: { propertyId: f.propertyId } } });
  if (f.q) and.push({ title: { contains: f.q, mode: "insensitive" } });
  const where: Prisma.TaskWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      include: taskInclude,
      orderBy: f.status === "completed" || f.status === "cancelled" ? [{ completedAt: "desc" }, { dueAt: "desc" }] : [{ dueAt: "asc" }],
      ...skipTake(f),
    }),
    db.task.count({ where }),
  ]);
  return { items: rows.map((r) => toTaskView(actor, r, now)), total, page: f.page, pageSize: f.pageSize };
}

/** Задачи, связанные с карточкой (клиент/потребность/сделка/объект), видимые пользователю. */
export async function listTasksLinkedTo(
  actor: Actor,
  link: { clientId?: string; needId?: string; dealId?: string; propertyId?: string; showingId?: string; agreementId?: string; advertisementId?: string; offerId?: string },
  opts: { includeClosed?: boolean; take?: number } = {},
): Promise<TaskView[]> {
  const and: Prisma.TaskWhereInput[] = [];
  if (link.clientId) and.push({ clientLinks: { some: { clientId: link.clientId } } });
  if (link.needId) and.push({ needLinks: { some: { clientNeedId: link.needId } } });
  if (link.dealId) and.push({ dealLinks: { some: { dealId: link.dealId } } });
  if (link.propertyId) and.push({ propertyLinks: { some: { propertyId: link.propertyId } } });
  if (link.showingId) and.push({ showingLinks: { some: { showingId: link.showingId } } });
  if (link.agreementId) and.push({ agreementLinks: { some: { agreementId: link.agreementId } } });
  if (link.advertisementId) and.push({ advertisementLinks: { some: { advertisementId: link.advertisementId } } });
  if (link.offerId) and.push({ offerLinks: { some: { commercialOfferId: link.offerId } } });
  if (!opts.includeClosed) and.push({ status: { in: [...OPEN_TASK_STATUSES] } });
  // Задачи по доступной карточке видны в её контексте (карточка уже проверена вызывающим кодом).
  const rows = await db.task.findMany({
    where: { AND: and },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: opts.take ?? 100,
  });
  return rows.map((r) => toTaskView(actor, r));
}

export async function getTask(actor: Actor, taskId: string): Promise<TaskView> {
  const row = await db.task.findFirst({ where: { id: taskId, ...taskScope(actor) }, include: taskInclude });
  if (!row) throw new NotFoundError();
  return toTaskView(actor, row);
}

/** Повторяемая серия: экземпляры с тем же корнем. */
export async function listRecurrenceSeries(actor: Actor, task: TaskView): Promise<{ id: string; dueAt: Date; status: string }[]> {
  const rootId = task.parentTaskId ?? task.id;
  return db.task.findMany({
    where: { OR: [{ id: rootId }, { parentTaskId: rootId }], ...taskScope(actor) },
    select: { id: true, dueAt: true, status: true },
    orderBy: { dueAt: "asc" },
    take: 50,
  });
}

export async function countOverdueTasks(actor: Actor): Promise<number> {
  return db.task.count({ where: { responsibleUserId: actor.userId, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: new Date() } } });
}

// ───────────────────────────── UC-10 GetTodayView ─────────────────────────────

export interface ControlItem {
  kind: "showing" | "agreement" | "advertisement" | "offer";
  id: string;
  title: string;
  dateLabel: Date;
  isDateOnly: boolean;
  href: string;
  overdue: boolean;
  responsibleName: string | null;
}

export interface TodayView {
  scope: "mine" | "all" | "user";
  counters: { overdue: number; today: number; week: number; needsWithoutNextAction: number };
  overdue: TaskView[];
  today: Record<TodayGroup, TaskView[]>;
  controls: Record<TodayGroup, ControlItem[]>;
  week: TaskView[];
}

const todayFiltersSchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  userId: zUuid.optional(),
});

/**
 * Экран «Сегодня» (UC-10, FR-25, ТЗ 37.4): вычисляемое представление над Task и контрольными датами
 * показов, договоров, рекламы и КП. Отдельной таблицы нет. Руководитель может переключить «Мои/Все»
 * и фильтр по сотруднику; риелтор видит только свои действия.
 */
export async function getTodayView(actor: Actor, rawFilters: unknown = {}): Promise<TodayView> {
  const f = parseInput(todayFiltersSchema, rawFilters);
  const cfg = getConfig();
  const now = new Date();
  const { startTomorrow, weekEnd } = dayBounds(now);
  const manager = isManager(actor);
  const scope: TodayView["scope"] = manager && f.userId ? "user" : manager && f.scope === "all" ? "all" : "mine";
  const userId = scope === "user" ? f.userId! : actor.userId;

  const taskWhere: Prisma.TaskWhereInput = {
    status: { in: [...OPEN_TASK_STATUSES] },
    ...(scope === "all" ? {} : { responsibleUserId: userId }),
  };
  const tasks = await db.task.findMany({
    where: { ...taskWhere, dueAt: { lt: weekEnd } },
    include: taskInclude,
    orderBy: { dueAt: "asc" },
    take: 500,
  });
  const views = tasks.map((t) => toTaskView(actor, t, now));
  const empty = (): Record<TodayGroup, never[]> => ({ calls: [], meetings: [], offers: [], documents: [], advertising: [], other: [] });
  const today: Record<TodayGroup, TaskView[]> = empty();
  const overdue: TaskView[] = [];
  const week: TaskView[] = [];
  for (const v of views) {
    if (v.dueAt < now) overdue.push(v);
    else if (v.dueAt < startTomorrow) today[todayGroupOf(v.taskType)].push(v);
    else week.push(v);
  }

  // Контрольные даты.
  const controls: Record<TodayGroup, ControlItem[]> = empty();
  const responsibleFilter = scope === "all" ? {} : { responsibleUserId: userId };
  const showings = await db.showing.findMany({
    where: { status: "planned", scheduledAt: { lt: startTomorrow }, ...responsibleFilter, ...showingScope(actor) },
    select: { id: true, scheduledAt: true, property: { select: { addressText: true } }, responsible: { select: { displayName: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });
  for (const s of showings)
    controls.meetings.push({
      kind: "showing",
      id: s.id,
      title: `Показ: ${s.property.addressText}`,
      dateLabel: s.scheduledAt,
      isDateOnly: false,
      href: `/showings/${s.id}`,
      overdue: s.scheduledAt < now,
      responsibleName: s.responsible.displayName,
    });

  const todayDate = todayAsDateOnly(now, cfg.APP_TIMEZONE);
  const agreementHorizon = addDays(todayDate, cfg.AGREEMENT_EXPIRY_WARNING_DAYS);
  const agreements = await db.agreement.findMany({
    where: {
      status: "signed",
      archivedAt: null,
      validUntil: { not: null, lte: agreementHorizon },
      ...responsibleFilter,
      ...agreementScope(actor),
    },
    select: { id: true, validUntil: true, agreementType: true, agreementNumber: true, property: { select: { addressText: true } }, responsible: { select: { displayName: true } } },
    orderBy: { validUntil: "asc" },
    take: 100,
  });
  for (const a of agreements)
    controls.documents.push({
      kind: "agreement",
      id: a.id,
      title: `Срок договора${a.agreementNumber ? ` № ${a.agreementNumber}` : ""}${a.property ? `: ${a.property.addressText}` : ""}`,
      dateLabel: a.validUntil!,
      isDateOnly: true,
      href: `/agreements/${a.id}`,
      overdue: a.validUntil! < todayDate,
      responsibleName: a.responsible.displayName,
    });

  const checkBefore = addDays(now, -cfg.AD_CHECK_INTERVAL_DAYS);
  const adHorizon = addDays(todayDate, 7);
  const ads = await db.advertisement.findMany({
    where: {
      status: "active",
      AND: [
        { OR: [{ expiresAt: { not: null, lte: adHorizon } }, { lastCheckedAt: null }, { lastCheckedAt: { lt: checkBefore } }] },
        scope === "all" ? {} : { OR: [{ responsibleUserId: userId }, { responsibleUserId: null, property: { responsibleUserId: userId } }] },
      ],
    },
    select: {
      id: true,
      platformCode: true,
      expiresAt: true,
      lastCheckedAt: true,
      property: { select: { addressText: true } },
      responsible: { select: { displayName: true } },
    },
    orderBy: { expiresAt: "asc" },
    take: 100,
  });
  for (const a of ads) {
    const expiring = a.expiresAt && a.expiresAt <= adHorizon;
    controls.advertising.push({
      kind: "advertisement",
      id: a.id,
      title: `${expiring ? "Истекает реклама" : "Проверить актуальность рекламы"}: ${a.property.addressText}`,
      dateLabel: expiring ? a.expiresAt! : (a.lastCheckedAt ?? now),
      isDateOnly: Boolean(expiring),
      href: `/advertisements/${a.id}`,
      overdue: Boolean(a.expiresAt && a.expiresAt < todayDate),
      responsibleName: a.responsible?.displayName ?? null,
    });
  }

  const offers = await db.commercialOffer.findMany({
    where: { status: "sent", expiresAt: { not: null, lte: addDays(todayDate, 3) }, ...responsibleFilter, ...offerScope(actor) },
    select: { id: true, title: true, expiresAt: true, responsible: { select: { displayName: true } } },
    take: 50,
  });
  for (const o of offers)
    controls.offers.push({
      kind: "offer",
      id: o.id,
      title: `Срок КП: ${o.title ?? "без названия"}`,
      dateLabel: o.expiresAt!,
      isDateOnly: true,
      href: `/offers/${o.id}`,
      overdue: o.expiresAt! < todayDate,
      responsibleName: o.responsible.displayName,
    });

  const needsWithoutNextAction = await db.clientNeed.count({
    where: {
      status: { in: ["active", "paused"] },
      ...(scope === "all" ? needScope(actor) : { responsibleUserId: userId }),
      taskLinks: { none: { task: { status: { in: [...OPEN_TASK_STATUSES] } } } },
    },
  });

  const todayCount = Object.values(today).reduce((n, list) => n + list.length, 0);
  return {
    scope,
    counters: { overdue: overdue.length, today: todayCount, week: week.length, needsWithoutNextAction },
    overdue,
    today,
    controls,
    week,
  };
}
