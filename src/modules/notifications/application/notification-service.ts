import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { agreementScope, clientScope, showingScope, taskScope } from "@/modules/access/domain/scopes";
import { NotFoundError } from "@/shared/errors";
import { parseInput, skipTake, zDateTime, zPagination } from "@/shared/validation";
import { notificationText } from "../domain/notification-rules";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { fromDateTimeLocalValue } from "@/shared/time";
import { safeTaskTextScope } from "./notification-context";
import { getCalendarEvent } from "@/modules/calendar/application/calendar-service";

async function visibleWhere(actor: Actor): Promise<Prisma.NotificationWhereInput> {
  const [tasks, showings, agreements, events] = await Promise.all([
    db.task.findMany({ where: taskScope(actor), select: { id: true } }),
    db.showing.findMany({ where: showingScope(actor), select: { id: true } }),
    db.agreement.findMany({ where: agreementScope(actor), select: { id: true } }),
    db.calendarEvent.findMany({ where: { ownerUserId: actor.userId, archivedAt: null }, select: { id: true } }),
  ]);
  return { recipientUserId: actor.userId, OR: [
    { sourceType: "task", sourceId: { in: tasks.map(t => t.id) } },
    { sourceType: "showing", sourceId: { in: showings.map(s => s.id) } },
    { sourceType: "agreement", sourceId: { in: agreements.map(a => a.id) } },
    { sourceType: "calendar_event", sourceId: { in: events.map(e => e.id) } },
  ] };
}

export async function listNotifications(actor: Actor, input: unknown) {
  const f = parseInput(zPagination.extend({ state: z.enum(["delivered", "read"]).optional() }), input);
  const where: Prisma.NotificationWhereInput = { AND: [await visibleWhere(actor), { state: f.state ?? { in: ["delivered", "read"] } }] };
  const [rows,total] = await Promise.all([db.notification.findMany({ where, ...skipTake(f), orderBy: [{ triggerAt: "desc" }, { id: "desc" }] }), db.notification.count({ where })]);
  const timeZone = getConfig().APP_TIMEZONE;
  const ids = (type: string) => rows.filter(n => n.sourceType === type).map(n => n.sourceId);
  const [tasks, showings, agreements] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids("task") }, AND: [taskScope(actor), safeTaskTextScope(actor)] }, select: { id: true, title: true, createdBy: true, dueAt: true, clientLinks: { take: 1, select: { client: { select: { displayName: true } } } }, needLinks: { take: 1, select: { need: { select: { client: { select: { displayName: true } } } } } }, propertyLinks: { take: 1, select: { property: { select: { addressText: true } } } } } }),
    db.showing.findMany({ where: { id: { in: ids("showing") }, AND: [showingScope(actor), { need: { client: clientScope(actor) } }] }, select: { id: true, scheduledAt: true, property: { select: { addressText: true } }, need: { select: { client: { select: { displayName: true } } } } } }),
    db.agreement.findMany({ where: { id: { in: ids("agreement") }, AND: [agreementScope(actor), { OR: [{ clientId: null }, { client: clientScope(actor) }] }, { OR: [{ dealId: null }, { deal: { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } } }] }] }, select: { id: true, agreementNumber: true, validUntil: true, client: { select: { displayName: true } }, property: { select: { addressText: true } } } }),
  ]);
  const items = await Promise.all(rows.map(async n => {
    const task = tasks.find(t => t.id === n.sourceId), showing = showings.find(s => s.id === n.sourceId), agreement = agreements.find(a => a.id === n.sourceId);
    let context: Parameters<typeof notificationText>[1] = {};
    if (n.sourceType === "task" && task) context = { title: task.createdBy === actor.userId || task.clientLinks.length || task.needLinks.length || task.propertyLinks.length ? task.title : null, client: task.clientLinks[0]?.client.displayName ?? task.needLinks[0]?.need.client.displayName, property: task.propertyLinks[0]?.property.addressText, at: task.dueAt.toISOString() };
    if (n.sourceType === "showing" && showing) context = { client: showing.need.client.displayName, property: showing.property.addressText, at: showing.scheduledAt.toISOString() };
    if (n.sourceType === "agreement" && agreement) context = { title: agreement.agreementNumber ? `№ ${agreement.agreementNumber}` : null, client: agreement.client?.displayName, property: agreement.property?.addressText, at: agreement.validUntil ? fromDateTimeLocalValue(`${agreement.validUntil.toISOString().slice(0,10)}T23:59`, timeZone) : null };
    if (n.sourceType === "calendar_event") {
      const event = await getCalendarEvent(actor, n.sourceId).catch(error => { if (error instanceof NotFoundError) return null; throw error; });
      const occurrence = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.exec(n.dedupKey)?.[0];
      if (event?.editable) context = { title: event.title, at: occurrence ?? event.startAt.toISOString(), end: new Date(+new Date(occurrence ?? event.startAt) + +event.endAt - +event.startAt).toISOString() };
    }
    const phase = n.dedupKey.includes(":overdue:") ? "Просрочено" : n.dedupKey.includes(":due:") ? "Срок наступил" : n.kind === "assignment" ? "Назначение" : "До срока";
    const text = notificationText(n.kind, context, timeZone);
    return { id: n.id, kind: n.kind, sourceType: n.sourceType, sourceId: n.sourceId,
    triggerAt: n.triggerAt, state: n.state, readAt: n.readAt, snoozedUntil: n.snoozedUntil,
    ...text, title: `${phase} · ${text.title}`, phase, link: sourceLink(n.sourceType, n.sourceId) };
  }));
  return { items, total, page: f.page, pageSize: f.pageSize };
}

function sourceLink(type: string, id: string) {
  return type === "task" ? `/tasks/${id}` : type === "showing" ? `/showings/${id}` : type === "agreement" ? `/agreements/${id}` : `/calendar?eventId=${id}`;
}

export async function unreadCount(actor: Actor) {
  return { count: await db.notification.count({ where: { AND: [await visibleWhere(actor), { state: "delivered", readAt: null }] } }) };
}

export async function readNotification(actor: Actor, id?: string) {
  const where: Prisma.NotificationWhereInput = { AND: [await visibleWhere(actor), { state: { in: ["delivered", "read"] }, ...(id ? { id } : {}) }] };
  const result = await db.notification.updateMany({ where, data: { state: "read", readAt: new Date() } });
  if (id && !result.count) throw new NotFoundError();
  return { count: result.count };
}

export async function snoozeNotification(actor: Actor, id: string, input: unknown) {
  const data = parseInput(z.object({ until: zDateTime.refine(d => +d > Date.now() && +d < Date.now() + 365 * 86400000, "Выберите будущее время в пределах года") }), input);
  const result = await db.notification.updateMany({ where: { AND: [await visibleWhere(actor), { id, state: { in: ["delivered", "read"] } }] },
    data: { state: "pending", readAt: null, snoozedUntil: data.until } });
  if (!result.count) throw new NotFoundError();
  return { ok: true };
}

export async function getNotificationPreference(actor: Actor) {
  return { leadMinutes: (await db.notificationPreference.findUnique({ where: { userId: actor.userId } }))?.leadMinutes ?? 15 };
}

export async function setNotificationPreference(actor: Actor, input: unknown) {
  const data = parseInput(z.object({ leadMinutes: z.number().int().min(0).max(525600) }), input);
  const preference = await db.notificationPreference.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...data }, update: data });
  return { leadMinutes: preference.leadMinutes };
}

export async function changeNotification(actor: Actor, id: string, input: unknown) {
  const data = parseInput(z.discriminatedUnion("action", [z.object({ action: z.literal("read") }), z.object({ action: z.literal("snooze"), until: z.string() })]), input);
  return data.action === "read" ? readNotification(actor, id) : snoozeNotification(actor, id, data);
}
