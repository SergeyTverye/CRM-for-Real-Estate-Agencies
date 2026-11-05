import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { agreementScope, showingScope, taskScope } from "@/modules/access/domain/scopes";
import { NotFoundError } from "@/shared/errors";
import { parseInput, skipTake, zDateTime, zPagination } from "@/shared/validation";
import { NOTIFICATION_TITLES } from "../domain/notification-rules";
import type { Prisma } from "@/generated/prisma/client";

/** Recheck source access at read time: reassignment/revocation must take effect immediately. */
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
  // Reconstruct title/link rather than trusting historical strings stored before access changes.
  return { items: rows.map(n => ({ id: n.id, kind: n.kind, sourceType: n.sourceType, sourceId: n.sourceId,
    triggerAt: n.triggerAt, state: n.state, readAt: n.readAt, snoozedUntil: n.snoozedUntil,
    title: NOTIFICATION_TITLES[n.kind] ?? "Напоминание", link: sourceLink(n.sourceType, n.sourceId) })), total, page: f.page, pageSize: f.pageSize };
}

function sourceLink(type: string, id: string) {
  return type === "task" ? `/tasks/${id}` : type === "showing" ? `/showings/${id}` : type === "agreement" ? `/agreements/${id}` : "/calendar";
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
