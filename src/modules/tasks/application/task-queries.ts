import { z } from "zod";
import { cache } from "react";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, startOfDayInTz, todayAsDateOnly } from "@/shared/time";
import { NotFoundError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zPagination, zUuid, type Page } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, canSeeNeed, clientScope, dealScope, needScope, showingScope, agreementScope, offerScope, taskScope } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES, todayGroupOf, type TodayGroup } from "../domain/task-rules";
import { todayTaskBucket, todayTaskRanges } from "@/modules/calendar/domain/today-counters";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { clientTaskContext } from "@/modules/clients/application/client-queries";

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

function taskIncludeFor(actor: Actor) {
  return {
    ...taskInclude,
    clientLinks: { ...taskInclude.clientLinks, where: { client: clientScope(actor) } },
    needLinks: { ...taskInclude.needLinks, where: { need: needScope(actor) } },
    showingLinks: { ...taskInclude.showingLinks, where: { showing: showingScope(actor) } },
    dealLinks: { ...taskInclude.dealLinks, where: { deal: dealScope(actor) } },
    agreementLinks: { ...taskInclude.agreementLinks, where: { agreement: agreementScope(actor) } },
    offerLinks: { ...taskInclude.offerLinks, where: { offer: offerScope(actor) } },
  } satisfies Prisma.TaskInclude;
}

export function toTaskView(actor: Actor, t: TaskRow, now = new Date()): TaskView {
  const links: TaskLinkView[] = [];
  for (const { client } of t.clientLinks) {
    const ok = canSeeClient(actor, client);
    if (ok) links.push({ kind: "client", id: client.id, label: client.displayName, href: `/clients/${client.id}` });
  }
  for (const { need } of t.needLinks) {
    const ok = canSeeNeed(actor, need);
    links.push({
      kind: "need",
      id: need.id,
      label: ok && canSeeClient(actor, need.client) ? `Потребность: ${need.client.displayName}` : "Потребность (нет доступа)",
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
  /** Drill-down из отчёта: только просроченные в выбранном представлении (в т.ч. «Все» у руководителя). */
  overdueOnly: z.enum(["yes"]).optional(),
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
  if (f.view === "overdue" || f.overdueOnly) and.push({ dueAt: { lt: now } });
  if (["overdue", "today", "week"].includes(f.view)) and.push({ NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } } });
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
      include: taskIncludeFor(actor),
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
  opts: { includeClosed?: boolean; take?: number; includeIndirectClient?: boolean } = {},
): Promise<TaskView[]> {
  const and: Prisma.TaskWhereInput[] = [taskScope(actor)];
  if (link.clientId) and.push(opts.includeIndirectClient ? { AND: [clientTaskContext(link.clientId), safeTaskTextScope(actor)] } : { clientLinks: { some: { clientId: link.clientId } } });
  if (link.needId) and.push({ needLinks: { some: { clientNeedId: link.needId } } });
  if (link.dealId) and.push({ dealLinks: { some: { dealId: link.dealId } } });
  if (link.propertyId) and.push({ propertyLinks: { some: { propertyId: link.propertyId } } });
  if (link.showingId) and.push({ showingLinks: { some: { showingId: link.showingId } } });
  if (link.agreementId) and.push({ agreementLinks: { some: { agreementId: link.agreementId } } });
  if (link.advertisementId) and.push({ advertisementLinks: { some: { advertisementId: link.advertisementId } } });
  if (link.offerId) and.push({ offerLinks: { some: { commercialOfferId: link.offerId } } });
  // Открытые задачи всегда загружаются полностью и идут первыми; завершённые — отдельно, с лимитом.
  const open = await db.task.findMany({
    where: { AND: [...and, { status: { in: [...OPEN_TASK_STATUSES] } }] },
    include: taskIncludeFor(actor),
    orderBy: { dueAt: "asc" },
    take: 200,
  });
  const closed = opts.includeClosed
    ? await db.task.findMany({
        where: { AND: [...and, { status: { notIn: [...OPEN_TASK_STATUSES] } }] },
        include: taskIncludeFor(actor),
        orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { dueAt: "desc" }],
        take: opts.take ?? 100,
      })
    : [];
  const rows = [...open, ...closed];
  return rows.map((r) => toTaskView(actor, r));
}

export async function getTask(actor: Actor, taskId: string): Promise<TaskView> {
  assertRecordId(taskId);
  const row = await db.task.findFirst({ where: { id: taskId, ...taskScope(actor) }, include: taskIncludeFor(actor) });
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

/** React request cache gives layout indicators and the page the same clock tick. */
export const getTodayReferenceTime = cache(() => new Date());

export async function countTodayTasks(actor: Actor, now = getTodayReferenceTime(), responsibleUserId: string | null = actor.userId) {
  const { startTomorrow, weekEnd } = dayBounds(now);
  const ranges = todayTaskRanges(now, startTomorrow, weekEnd);
  const where: Prisma.TaskWhereInput = {
    AND: [taskScope(actor)], ...(responsibleUserId ? { responsibleUserId } : {}),
    status: { in: [...OPEN_TASK_STATUSES] },
    NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } },
  };
  const count = (dueAt: Prisma.DateTimeFilter) => db.task.count({ where: { ...where, dueAt } });
  const [overdue, today, upcoming] = await Promise.all([count(ranges.overdue), count(ranges.today), count(ranges.upcoming)]);
  return { overdue, today, upcoming };
}

export async function countOverdueTasks(actor: Actor, now = getTodayReferenceTime()): Promise<number> {
  return (await countTodayTasks(actor, now)).overdue;
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
  counters: { overdue: number; today: number; week: number; needsWithoutNextAction: number; showingsToday: number };
  overdue: TaskView[];
  today: Record<TodayGroup, TaskView[]>;
  controls: Record<TodayGroup, ControlItem[]>;
  week: TaskView[];
  showingsToday: ControlItem[];
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
export async function getTodayView(actor: Actor, rawFilters: unknown = {}, now = getTodayReferenceTime()): Promise<TodayView> {
  const f = parseInput(todayFiltersSchema, rawFilters);
  const cfg = getConfig();
  const { startTomorrow, weekEnd } = dayBounds(now);
  const manager = isManager(actor);
  const scope: TodayView["scope"] = manager && f.userId ? "user" : manager && f.scope === "all" ? "all" : "mine";
  const userId = scope === "user" ? f.userId! : actor.userId;

  const taskWhere: Prisma.TaskWhereInput = {
    AND: [taskScope(actor)],
    NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } },
    status: { in: [...OPEN_TASK_STATUSES] },
    ...(scope === "all" ? {} : { responsibleUserId: userId }),
  };
  // A large overdue queue must not displace today's or next week's actions.
  const tasks = (await Promise.all([
    ...Object.values(todayTaskRanges(now, startTomorrow, weekEnd)),
  ].map(dueAt => db.task.findMany({ where: { ...taskWhere, dueAt }, include: taskIncludeFor(actor), orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 200 })))).flat();
  const safeIds = new Set((await db.task.findMany({ where: { id: { in: tasks.map(t => t.id) }, AND: [safeTaskTextScope(actor)] }, select: { id: true } })).map(t => t.id));
  const views = tasks.map((t) => toTaskView(actor, safeIds.has(t.id) ? t : { ...t, title: "Задача", description: null }, now));
  const empty = (): Record<TodayGroup, never[]> => ({ calls: [], meetings: [], offers: [], documents: [], advertising: [], other: [] });
  const today: Record<TodayGroup, TaskView[]> = empty();
  const overdue: TaskView[] = [];
  const week: TaskView[] = [];
  for (const v of views) {
    const bucket = todayTaskBucket(v, now, startTomorrow, weekEnd);
    if (bucket === "overdue") overdue.push(v);
    else if (bucket === "today") today[todayGroupOf(v.taskType)].push(v);
    else if (bucket === "week") week.push(v);
  }

  // Контрольные даты.
  const controls: Record<TodayGroup, ControlItem[]> = empty();
  const responsibleFilter = scope === "all" ? {} : { responsibleUserId: userId };
  const showings = await db.showing.findMany({
    where: {
      status: "planned",
      scheduledAt: { lt: dayBounds(now).startToday },
      ...responsibleFilter,
      ...showingScope(actor),
    },
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

  const todayShowings = await db.showing.findMany({ where: { AND: [showingScope(actor)], ...responsibleFilter, status: "planned", scheduledAt: { gte: dayBounds(now).startToday, lt: startTomorrow } },
    select: { id: true, scheduledAt: true, property: { select: { addressText: true } }, responsible: { select: { displayName: true } } }, orderBy: { scheduledAt: "asc" }, take: 200 });
  const showingsToday: ControlItem[] = todayShowings.map(s => ({ kind: "showing", id: s.id, title: `Показ: ${s.property.addressText}`, dateLabel: s.scheduledAt, isDateOnly: false, href: `/showings/${s.id}`, overdue: s.scheduledAt < now, responsibleName: s.responsible.displayName }));
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
      ...(scope === "all" ? needScope(actor) : { responsibleUserId: userId }),
      AND: [{ OR: [
        { status: "active", taskLinks: { none: { task: { status: { in: [...OPEN_TASK_STATUSES] } } } } },
        { status: "paused", taskLinks: { none: { task: { status: { in: [...OPEN_TASK_STATUSES] }, taskType: "pause_return" } } } },
      ] }],
    },
  });

  const [taskCounts, showingsTodayCount] = await Promise.all([
    countTodayTasks(actor, now, scope === "all" ? null : userId),
    db.showing.count({ where: { AND: [showingScope(actor)], ...responsibleFilter, status: "planned", scheduledAt: { gte: dayBounds(now).startToday, lt: startTomorrow } } }),
  ]);
  return {
    scope,
    counters: { overdue: taskCounts.overdue, today: taskCounts.today, week: taskCounts.upcoming, needsWithoutNextAction, showingsToday: showingsTodayCount },
    overdue,
    today,
    controls,
    week,
    showingsToday,
  };
}
