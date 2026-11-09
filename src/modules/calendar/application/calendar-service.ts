import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { type Actor, isManager } from "@/modules/auth/domain/actor";
import { agreementScope, clientScope, dealScope, needScope, showingScope, taskScope } from "@/modules/access/domain/scopes";
import { parseInput, zCode, zDateTime, zExpectedUpdatedAt, zOptText, zRequiredText, zUuid } from "@/shared/validation";
import { ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { writeAudit } from "@/modules/audit/application/audit";
import { createTask, updateTask } from "@/modules/tasks/application/task-service";
import { scheduleShowing, updateShowing } from "@/modules/showings/application/showing-service";
import { fromDateTimeLocalValue, localDateString, startOfDayInTz } from "@/shared/time";
import { freeIntervals, occurrences, parseRecurrence, privateProjection, type CalendarItem } from "../domain/calendar-rules";
import { plannerTone } from "../domain/planner-rules";

const calendarInstant = z.string().regex(/(?:Z|[+-]\d{2}:\d{2})$/, "Укажите ISO-время с часовым поясом").pipe(zDateTime);
export const rangeSchema = z.object({
  from: calendarInstant, to: calendarInstant, employee: zUuid.optional(),
  type: z.enum(["task", "showing", "agreement", "calendar_event"]).optional(),
  status: z.string().max(40).optional(),
  clientId: zUuid.optional(), priority: zCode("taskPriority").optional(),
  deadline: z.enum(["overdue", "soon", "controlled", "closed"]).optional(),
}).refine(d => d.to > d.from && +d.to - +d.from <= 100 * 86400000, "Период: от 1 до 100 дней");

export async function listCalendar(actor: Actor, input: unknown, options: { recurringOnly?: boolean; now?: Date; soonHours?: number } = {}): Promise<CalendarItem[]> {
  const f = parseInput(rangeSchema, input);
  if (f.clientId && !await db.client.count({ where: { id: f.clientId, ...clientScope(actor) } })) throw new NotFoundError();
  const client = f.clientId;
  const timeZone = getConfig().APP_TIMEZONE;
  const time = { gte: f.from, lt: f.to };
  const employee = f.employee ? { responsibleUserId: f.employee } : {};
  const status = f.status ? { status: f.status } : {};
  const items: CalendarItem[] = [];
  if (!f.type || f.type === "task") {
    const tasks = await db.task.findMany({ where: { AND: [taskScope(actor), employee, status,
      { dueAt: time, ...(f.priority ? { priority: f.priority } : {}), ...(client ? { OR: [{ clientLinks: { some: { clientId: client } } }, { needLinks: { some: { need: { clientId: client } } } }] } : {}), NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } } } ] },
      take: 1001, orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { id: true, dueAt: true, priority: true, status: true, updatedAt: true, responsibleUserId: true } });
    if (tasks.length > 1000) throw new ValidationError("Слишком много задач. Уточните фильтры или выберите один день.");
    const safeTitles = new Map((await db.task.findMany({ where: { id: { in: tasks.map(t => t.id) }, AND: [
      { clientLinks: { none: { client: { NOT: clientScope(actor) } } } },
      { needLinks: { none: { need: { client: { NOT: clientScope(actor) } } } } },
      { showingLinks: { none: { showing: { need: { client: { NOT: clientScope(actor) } } } } } },
      { offerLinks: { none: { offer: { need: { client: { NOT: clientScope(actor) } } } } } },
      { agreementLinks: { none: { agreement: { client: { NOT: clientScope(actor) } } } } },
      { dealLinks: { none: { deal: { parties: { some: { client: { NOT: clientScope(actor) } } } } } } },
    ] }, select: { id: true, title: true } })).map(t => [t.id,t.title]));
    items.push(...tasks.map(t => ({ id: `task:${t.id}`, sourceId: t.id, type: "task" as const,
      title: safeTitles.get(t.id) ?? "Задача", start: t.dueAt.toISOString(), status: t.status, ownerUserId: t.responsibleUserId,
      priority: t.priority, updatedAt: t.updatedAt.toISOString(), editable: ["planned", "in_progress"].includes(t.status), url: `/tasks/${t.id}` })));
  }
  if (!f.type || f.type === "showing") {
    const showings = await db.showing.findMany({ where: { AND: [showingScope(actor), employee, status, { scheduledAt: time, ...(client ? { need: { clientId: client } } : {}) }] }, take: 1001,
      select: { id: true, scheduledAt: true, status: true, updatedAt: true, responsibleUserId: true } });
    if (showings.length > 1000) throw new ValidationError("Уточните период показов");
    items.push(...showings.map(s => ({ id: `showing:${s.id}`, sourceId: s.id, type: "showing" as const,
      title: "Показ", start: s.scheduledAt.toISOString(), status: s.status, ownerUserId: s.responsibleUserId,
      updatedAt: s.updatedAt.toISOString(), editable: s.status === "planned", url: `/showings/${s.id}` })));
  }
  if (!f.type || f.type === "agreement") {
    const agreements = await db.agreement.findMany({ where: { AND: [agreementScope(actor), employee, status, { archivedAt: null,
      ...(client ? { clientId: client } : {}), OR: [{ validFrom: { gte: new Date(`${localDateString(f.from,timeZone)}T00:00:00Z`), lte: f.to } },
        { validUntil: { gte: new Date(`${localDateString(f.from,timeZone)}T00:00:00Z`), lte: f.to } }] }] },
      take: 1001, select: { id: true, validFrom: true, validUntil: true, status: true, responsibleUserId: true } });
    if (agreements.length > 1000) throw new ValidationError("Уточните период договоров");
    for (const a of agreements) for (const field of ["validFrom", "validUntil"] as const) {
      if (!a[field]) continue;
      const at = fromDateTimeLocalValue(`${a[field].toISOString().slice(0,10)}T00:00`, timeZone);
      if (new Date(at) >= f.from && new Date(at) < f.to) items.push({ id: `agreement:${a.id}:${field}`, sourceId: a.id,
        type: "agreement", title: field === "validUntil" ? "Окончание договора" : "Начало договора", start: at,
        allDay: true, status: a.status, ownerUserId: a.responsibleUserId, editable: false, url: `/agreements/${a.id}` });
    }
  }
  if (!f.type || f.type === "calendar_event") {
    const events = await db.calendarEvent.findMany({ where: { archivedAt: null, startAt: { lt: f.to },
      ...(options.recurringOnly ? { recurrenceRule: { not: null } } : {}),
      ...(f.employee ? { ownerUserId: f.employee } : {}), OR: [{ endAt: { gt: f.from } }, { recurrenceRule: { not: null } }] }, take: 1001 });
    if (events.length > 1000) throw new ValidationError("Слишком много встреч. Уточните период или сотрудника.");
    
    const [access, needClient] = await Promise.all([
      batchLinksAccessible(db, actor, events),
      client ? needClientMap(db, events) : Promise.resolve(new Map<string, string | null>()),
    ]);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const canRead = (e.visibility !== "private" || e.ownerUserId === actor.userId) && access[i]!;
      if (client && (!canRead || (e.clientId !== client && needClient.get(e.id) !== client))) continue;
      for (const occurrence of occurrences({ start: e.startAt.toISOString(), end: e.endAt.toISOString(), recurrenceRule: e.recurrenceRule }, f.from, f.to, timeZone)) {
        const item: CalendarItem = { id: `calendar_event:${e.id}:${occurrence.start}`, sourceId: e.id,
          type: "calendar_event", title: e.title, description: e.description, ...occurrence, status: "scheduled",
          allDay: e.allDay, ownerUserId: e.ownerUserId, updatedAt: e.updatedAt.toISOString(),
          url: `/calendar?eventId=${e.id}`,
          editable: e.ownerUserId === actor.userId, recurrenceRule: e.recurrenceRule };
        const projected = canRead ? item : privateProjection(item);
        if (!f.status || projected.status === f.status) items.push(projected);
      }
    }
  }
  const soonHours = options.soonHours ?? (await db.plannerSetting.findFirst())?.soonThresholdHours ?? 24;
  return items.map(item => ({ ...item, tone: plannerTone(item.status, new Date(item.start), item.priority, options.now, soonHours) }))
    .filter(item => (!f.priority || (item.priority ?? "normal") === f.priority) && (!f.deadline || item.tone === ({ overdue: "red", soon: "yellow", controlled: "green", closed: "gray" } as const)[f.deadline]))
    .sort((a,b) => a.start.localeCompare(b.start));
}

type Links = { clientId?: string | null; needId?: string | null; propertyId?: string | null; dealId?: string | null };
async function linksAccessible(tx: DbOrTx, actor: Actor, data: Links): Promise<boolean> {
  if (data.clientId && !await tx.client.count({ where: { id: data.clientId, ...clientScope(actor) } })) return false;
  if (data.needId && !await tx.clientNeed.count({ where: { AND: [{ id: data.needId }, needScope(actor), { client: clientScope(actor) }] } })) return false;
  if (data.dealId && !await tx.deal.count({ where: { AND: [{ id: data.dealId }, dealScope(actor),
    { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] } })) return false;
  if (data.propertyId && !await tx.property.count({ where: { id: data.propertyId } })) return false;
  return true;
}


export async function batchLinksAccessible(tx: DbOrTx, actor: Actor, items: Links[]): Promise<boolean[]> {
  const pick = (key: keyof Links) => [...new Set(items.map(e => e[key]).filter((v): v is string => !!v))];
  const clientIds = pick("clientId"), needIds = pick("needId"), dealIds = pick("dealId"), propertyIds = pick("propertyId");
  const [clients, needs, deals, props] = await Promise.all([
    clientIds.length ? tx.client.findMany({ where: { id: { in: clientIds }, ...clientScope(actor) }, select: { id: true } }) : [],
    needIds.length ? tx.clientNeed.findMany({ where: { AND: [{ id: { in: needIds } }, needScope(actor), { client: clientScope(actor) }] }, select: { id: true } }) : [],
    dealIds.length ? tx.deal.findMany({ where: { AND: [{ id: { in: dealIds } }, dealScope(actor),
      { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] }, select: { id: true } }) : [],
    propertyIds.length ? tx.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } }) : [],
  ]);
  const has = (rows: { id: string }[]) => new Set(rows.map(r => r.id));
  const okClient = has(clients), okNeed = has(needs), okDeal = has(deals), okProp = has(props);
  return items.map(e =>
    (!e.clientId || okClient.has(e.clientId)) &&
    (!e.needId || okNeed.has(e.needId)) &&
    (!e.dealId || okDeal.has(e.dealId)) &&
    (!e.propertyId || okProp.has(e.propertyId)));
}


export async function needClientMap(tx: DbOrTx, events: { id: string; needId?: string | null }[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(events.map(e => e.needId).filter((v): v is string => !!v))];
  const rows = ids.length ? await tx.clientNeed.findMany({ where: { id: { in: ids } }, select: { id: true, clientId: true } }) : [];
  const byNeed = new Map(rows.map(r => [r.id, r.clientId]));
  return new Map(events.map(e => [e.id, e.needId ? byNeed.get(e.needId) ?? null : null]));
}

const eventFields = z.object({
  title: zRequiredText(300), description: zOptText(4000), startAt: calendarInstant, endAt: calendarInstant,
  allDay: z.boolean().default(false), visibility: zCode("calendarVisibility").default("private"),
  ownerUserId: zUuid.optional(), recurrenceRule: z.string().max(100).nullable().optional(),
  clientId: zUuid.nullish(), needId: zUuid.nullish(), propertyId: zUuid.nullish(), dealId: zUuid.nullish(),
});
const validateEvent = <T extends { startAt: Date; endAt: Date; recurrenceRule?: string | null }>(data: T) => {
  if (data.endAt <= data.startAt) throw new ValidationError("Окончание должно быть позже начала");
  try {
    const rule = parseRecurrence(data.recurrenceRule);
    if (rule?.until && rule.until < data.startAt) throw new Error("UNTIL не может быть раньше начала");
  } catch (e) { throw new ValidationError((e as Error).message); }
};

export async function saveCalendarEvent(actor: Actor, input: unknown, id?: string) {
  const data = parseInput(id ? eventFields.extend({ expectedUpdatedAt: zExpectedUpdatedAt }) : eventFields, input);
  validateEvent(data);
  if (data.allDay) {
    const timeZone = getConfig().APP_TIMEZONE;
    data.startAt = startOfDayInTz(data.startAt,timeZone);
    const midnight = startOfDayInTz(data.endAt,timeZone);
    data.endAt = +midnight === +data.endAt ? midnight : new Date(+midnight+86400000);
    validateEvent(data);
  }
  return transaction(async tx => {
    if (id && !await tx.calendarEvent.findFirst({ where: { id, ownerUserId: actor.userId, archivedAt: null } })) throw new NotFoundError();
    const ownerUserId = data.ownerUserId ?? actor.userId;
    if (ownerUserId !== actor.userId && (!isManager(actor) || id)) throw new ForbiddenError();
    if (!await tx.user.count({ where: { id: ownerUserId, isActive: true } })) throw new ValidationError("Ответственный недоступен");
    if (!await linksAccessible(tx, actor, data)) throw new NotFoundError();
    const owner = await tx.user.findUniqueOrThrow({ where: { id: ownerUserId }, select: { roleCode: true } });
    if (!await linksAccessible(tx, { ...actor, userId: ownerUserId, role: owner.roleCode as Actor["role"] }, data)) throw new NotFoundError();
    const { ownerUserId: _owner, ...fields } = data;
    void _owner;
    const { expectedUpdatedAt, ...values } = fields as typeof fields & { expectedUpdatedAt?: Date };
    let eventId = id;
    if (id) {
      const changed = await tx.calendarEvent.updateMany({ where: { id, ownerUserId: actor.userId, updatedAt: expectedUpdatedAt }, data: { ...values, ownerUserId } });
      if (!changed.count) throw new StaleUpdateError();
    } else eventId = (await tx.calendarEvent.create({ data: { ...values, ownerUserId } })).id;
    await writeAudit(tx, { actorUserId: actor.userId, action: id ? "calendar.updated" : "calendar.created", entityType: "CalendarEvent", entityId: eventId!, after: { startAt: data.startAt.toISOString(), endAt: data.endAt.toISOString() } });
    const horizon = data.recurrenceRule ? new Date(+data.endAt + 90*86400000) : data.endAt;
    const candidates = await tx.calendarEvent.findMany({ where: { ownerUserId, archivedAt: null, id: { not: eventId }, startAt: { lt: horizon }, OR: [{ endAt: { gt: data.startAt } }, { recurrenceRule: { not: null } }] }, select: { startAt: true, endAt: true, recurrenceRule: true } });
    const proposed = occurrences({ start: data.startAt.toISOString(), end: data.endAt.toISOString(), recurrenceRule: data.recurrenceRule },data.startAt,horizon,getConfig().APP_TIMEZONE);
    const overlap = candidates.some(e => occurrences({ start: e.startAt.toISOString(), end: e.endAt.toISOString(), recurrenceRule: e.recurrenceRule }, data.startAt, horizon, getConfig().APP_TIMEZONE).some(o => proposed.some(p => Date.parse(o.start) < Date.parse(p.end!) && Date.parse(o.end!) > Date.parse(p.start))));
    return { id: eventId!, warning: overlap ? "Встреча сохранена, но это время уже занято другой встречей. Проверьте расписание и при необходимости перенесите встречу. Для повторений проверены ближайшие 90 дней." : null };
  });
}

export async function archiveCalendarEvent(actor: Actor, id: string, input: unknown) {
  const data = parseInput(z.object({ expectedUpdatedAt: zExpectedUpdatedAt }), input);
  return transaction(async tx => {
    if (!await tx.calendarEvent.count({ where: { id, ownerUserId: actor.userId, archivedAt: null } })) throw new NotFoundError();
    if (!(await tx.calendarEvent.updateMany({ where: { id, ownerUserId: actor.userId, updatedAt: data.expectedUpdatedAt, archivedAt: null }, data: { archivedAt: new Date() } })).count) throw new StaleUpdateError();
    await writeAudit(tx, { actorUserId: actor.userId, action: "calendar.archived", entityType: "CalendarEvent", entityId: id });
    return { ok: true };
  });
}

export async function getCalendarEvent(actor: Actor, id: string) {
  const e = await db.calendarEvent.findFirst({ where: { id, archivedAt: null } });
  if (!e) throw new NotFoundError();
  if ((e.ownerUserId !== actor.userId && e.visibility === "private") || !await linksAccessible(db, actor, e))
    return { title: "Занято", startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, editable: false };
  const [client, need, property, deal] = await Promise.all([
    e.clientId ? db.client.findUnique({ where: { id: e.clientId }, select: { id: true, displayName: true } }) : null,
    e.needId ? db.clientNeed.findUnique({ where: { id: e.needId }, select: { id: true, district: true, client: { select: { displayName: true } } } }) : null,
    e.propertyId ? db.property.findUnique({ where: { id: e.propertyId }, select: { id: true, addressText: true } }) : null,
    e.dealId ? db.deal.findUnique({ where: { id: e.dealId }, select: { id: true, property: { select: { addressText: true } } } }) : null,
  ]);
  return { ...e, editable: e.ownerUserId === actor.userId, linked: {
    clientId: client ? { id: client.id, label: client.displayName } : null,
    needId: need ? { id: need.id, label: `${need.client.displayName}${need.district ? ` · ${need.district}` : ""}` } : null,
    propertyId: property ? { id: property.id, label: property.addressText } : null,
    dealId: deal ? { id: deal.id, label: deal.property.addressText } : null,
  } };
}

export async function pickCalendarLinks(actor: Actor, raw: unknown) {
  const f = parseInput(z.object({ type: z.enum(["clientId", "needId", "propertyId", "dealId"]), q: z.string().trim().max(200).default("") }), raw);
  const text = { contains: f.q, mode: "insensitive" as const };
  if (f.type === "clientId") return db.client.findMany({ where: { AND: [clientScope(actor), { status: { not: "archived" }, displayName: text }] }, take: 20, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }).then(rows => rows.map(r => ({ id: r.id, label: r.displayName })));
  if (f.type === "propertyId") return db.property.findMany({ where: { archivedAt: null, addressText: text }, take: 20, orderBy: { addressText: "asc" }, select: { id: true, addressText: true } }).then(rows => rows.map(r => ({ id: r.id, label: r.addressText })));
  if (f.type === "needId") return db.clientNeed.findMany({ where: { AND: [needScope(actor), { client: clientScope(actor) }, { OR: [{ client: { displayName: text } }, { district: text }] }] }, take: 20, orderBy: { updatedAt: "desc" }, select: { id: true, district: true, client: { select: { displayName: true } } } }).then(rows => rows.map(r => ({ id: r.id, label: `${r.client.displayName}${r.district ? ` · ${r.district}` : ""}` })));
  return db.deal.findMany({ where: { AND: [dealScope(actor), { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }, { property: { addressText: text } }] }, take: 20, orderBy: { updatedAt: "desc" }, select: { id: true, property: { select: { addressText: true } } } }).then(rows => rows.map(r => ({ id: r.id, label: r.property.addressText })));
}

export async function moveCalendarSource(actor: Actor, input: unknown) {
  const d = parseInput(z.object({ type: z.enum(["task", "showing", "calendar_event"]), id: zUuid,
    startAt: calendarInstant, endAt: calendarInstant.optional(), expectedUpdatedAt: zExpectedUpdatedAt }), input);
  if (d.type === "task") {
    const task = await db.task.findFirst({ where: { id: d.id, ...taskScope(actor) }, select: { taskType: true, showingLinks: { select: { showingId: true } } } });
    if (!task) throw new NotFoundError();
    if (task.taskType === "showing_or_meeting" && task.showingLinks.length) throw new ValidationError("Перенесите связанный показ через календарь показов");
    return updateTask(actor, d.id, { dueAt: d.startAt.toISOString(), expectedUpdatedAt: d.expectedUpdatedAt.toISOString() });
  }
  if (d.type === "showing") return updateShowing(actor, d.id, { scheduledAt: d.startAt.toISOString(), expectedUpdatedAt: d.expectedUpdatedAt.toISOString() });
  const e = await db.calendarEvent.findFirst({ where: { id: d.id, ownerUserId: actor.userId, archivedAt: null } });
  if (!e) throw new NotFoundError();
  if (e.recurrenceRule) throw new ValidationError("Повторяющуюся встречу измените в форме серии");
  return saveCalendarEvent(actor, { ...e, startAt: d.startAt.toISOString(), endAt: (d.endAt ?? new Date(+d.startAt + +e.endAt - +e.startAt)).toISOString(), expectedUpdatedAt: d.expectedUpdatedAt.toISOString() }, d.id);
}

export async function quickCreateCalendarSource(actor: Actor, input: unknown) {
  const d = parseInput(z.object({ type: z.enum(["task", "showing", "calendar_event"]), data: z.unknown() }), input);
  if (d.type === "task") return createTask(actor, d.data);
  if (d.type === "showing") return scheduleShowing(actor, d.data);
  return saveCalendarEvent(actor, d.data);
}

export async function todayAgenda(actor: Actor, employee: string | undefined = actor.userId) {
  const start = startOfDayInTz(new Date(), getConfig().APP_TIMEZONE), end = new Date(+start + 86400000);
  const items = await listCalendar(actor, { from: start.toISOString(), to: new Date(+end + 6 * 86400000).toISOString(), ...(employee ? { employee } : {}) });
  return { items: items.filter(e => !["completed", "cancelled", "no_show", "archived"].includes(e.status) && (new Date(e.start) < end || e.type === "showing")),
    free: freeIntervals(new Date(+start + 9 * 3600000), new Date(+start + 18 * 3600000), items.filter(e => e.type === "calendar_event")) };
}
