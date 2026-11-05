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

const calendarInstant = z.string().regex(/(?:Z|[+-]\d{2}:\d{2})$/, "Укажите ISO-время с часовым поясом").pipe(zDateTime);
const rangeSchema = z.object({
  from: calendarInstant, to: calendarInstant, employee: zUuid.optional(),
  type: z.enum(["task", "showing", "agreement", "calendar_event"]).optional(),
  status: z.string().max(40).optional(),
}).refine(d => d.to > d.from && +d.to - +d.from <= 100 * 86400000, "Период: от 1 до 100 дней");

export async function listCalendar(actor: Actor, input: unknown): Promise<CalendarItem[]> {
  const f = parseInput(rangeSchema, input);
  const timeZone = getConfig().APP_TIMEZONE;
  const time = { gte: f.from, lt: f.to };
  const employee = f.employee ? { responsibleUserId: f.employee } : {};
  const status = f.status ? { status: f.status } : {};
  const items: CalendarItem[] = [];
  if (!f.type || f.type === "task") {
    const tasks = await db.task.findMany({ where: { AND: [taskScope(actor), employee, status,
      { dueAt: time, NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } } } ] },
      select: { id: true, dueAt: true, status: true, updatedAt: true, responsibleUserId: true } });
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
      updatedAt: t.updatedAt.toISOString(), editable: ["planned", "in_progress"].includes(t.status), url: `/tasks/${t.id}` })));
  }
  if (!f.type || f.type === "showing") {
    const showings = await db.showing.findMany({ where: { AND: [showingScope(actor), employee, status, { scheduledAt: time }] },
      select: { id: true, scheduledAt: true, status: true, updatedAt: true, responsibleUserId: true } });
    items.push(...showings.map(s => ({ id: `showing:${s.id}`, sourceId: s.id, type: "showing" as const,
      title: "Показ", start: s.scheduledAt.toISOString(), status: s.status, ownerUserId: s.responsibleUserId,
      updatedAt: s.updatedAt.toISOString(), editable: s.status === "planned", url: `/showings/${s.id}` })));
  }
  if (!f.type || f.type === "agreement") {
    const agreements = await db.agreement.findMany({ where: { AND: [agreementScope(actor), employee, status, { archivedAt: null,
      OR: [{ validFrom: { gte: new Date(`${localDateString(f.from,timeZone)}T00:00:00Z`), lte: f.to } },
        { validUntil: { gte: new Date(`${localDateString(f.from,timeZone)}T00:00:00Z`), lte: f.to } }] }] },
      select: { id: true, validFrom: true, validUntil: true, status: true, responsibleUserId: true } });
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
      ...(f.employee ? { ownerUserId: f.employee } : {}), OR: [{ endAt: { gt: f.from } }, { recurrenceRule: { not: null } }] } });
    for (const e of events) {
      const canRead = (e.visibility !== "private" || e.ownerUserId === actor.userId) && await linksAccessible(db, actor, e);
      for (const occurrence of occurrences({ start: e.startAt.toISOString(), end: e.endAt.toISOString(), recurrenceRule: e.recurrenceRule }, f.from, f.to, timeZone)) {
        const item: CalendarItem = { id: `calendar_event:${e.id}:${occurrence.start}`, sourceId: e.id,
          type: "calendar_event", title: e.title, description: e.description, ...occurrence, status: "scheduled",
          allDay: e.allDay, ownerUserId: e.ownerUserId, updatedAt: e.updatedAt.toISOString(),
          editable: e.ownerUserId === actor.userId, recurrenceRule: e.recurrenceRule };
        const projected = canRead ? item : privateProjection(item);
        if (!f.status || projected.status === f.status) items.push(projected);
      }
    }
  }
  return items.sort((a,b) => a.start.localeCompare(b.start));
}

type Links = { clientId?: string | null; needId?: string | null; propertyId?: string | null; dealId?: string | null };
async function linksAccessible(tx: DbOrTx, actor: Actor, data: Links): Promise<boolean> {
  if (data.clientId && !await tx.client.count({ where: { id: data.clientId, ...clientScope(actor) } })) return false;
  // Need ownership alone does not confer access to its client.
  if (data.needId && !await tx.clientNeed.count({ where: { AND: [{ id: data.needId }, needScope(actor), { client: clientScope(actor) }] } })) return false;
  if (data.dealId && !await tx.deal.count({ where: { AND: [{ id: data.dealId }, dealScope(actor),
    { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] } })) return false;
  if (data.propertyId && !await tx.property.count({ where: { id: data.propertyId } })) return false;
  return true;
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
    // Check the recipient's access as well; sharing cannot hand another employee a foreign client.
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
    return { id: eventId!, warning: overlap ? "Встреча пересекается с другой записью" : null };
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
  return { ...e, editable: e.ownerUserId === actor.userId };
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
  // Moving a recurrence edits the series explicitly; UI disables dragging occurrences.
  if (e.recurrenceRule) throw new ValidationError("Повторяющуюся встречу измените в форме серии");
  return saveCalendarEvent(actor, { ...e, startAt: d.startAt.toISOString(), endAt: (d.endAt ?? new Date(+d.startAt + +e.endAt - +e.startAt)).toISOString(), expectedUpdatedAt: d.expectedUpdatedAt.toISOString() }, d.id);
}

export async function quickCreateCalendarSource(actor: Actor, input: unknown) {
  const d = parseInput(z.object({ type: z.enum(["task", "showing", "calendar_event"]), data: z.unknown() }), input);
  if (d.type === "task") return createTask(actor, d.data);
  if (d.type === "showing") return scheduleShowing(actor, d.data);
  return saveCalendarEvent(actor, d.data);
}

export async function todayAgenda(actor: Actor, employee = actor.userId) {
  const start = startOfDayInTz(new Date(), getConfig().APP_TIMEZONE), end = new Date(+start + 86400000);
  const items = await listCalendar(actor, { from: start.toISOString(), to: new Date(+end + 6 * 86400000).toISOString(), employee });
  return { items: items.filter(e => !["completed", "cancelled", "no_show", "archived"].includes(e.status) && (new Date(e.start) < end || e.type === "showing")),
    free: freeIntervals(new Date(+start + 9 * 3600000), new Date(+start + 18 * 3600000), items.filter(e => e.type === "calendar_event")) };
}
