import { type Tx, transaction, disconnectDb } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { fromDateTimeLocalValue } from "@/shared/time";
import { notificationKey, NOTIFICATION_TITLES, reminderAt, taskNotificationKind } from "../domain/notification-rules";
import { occurrences } from "@/modules/calendar/domain/calendar-rules";

type Planned = { recipientUserId: string; kind: string; sourceType: string; sourceId: string;
  triggerAt: Date; title: string; link: string; dedupKey: string };

export const stopNotificationWorker = disconnectDb;

/** One transaction/connection owns the advisory lock until delivery finishes. No browser required. */
export async function generateNotifications(now = new Date()) {
  if (getConfig().isReadOnlyInstance) return { active: false, locked: false, delivered: 0 };
  return transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(241008, 1) AS locked`;
    if (!lock?.locked) return { active: true, locked: false, delivered: 0 };
    const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true, notificationPreference: { select: { leadMinutes: true } } } });
    const preferences = new Map(users.map(u => [u.id, u.notificationPreference?.leadMinutes ?? 15]));
    const planned: Planned[] = [];
    const add = (recipient: string, sourceType: string, sourceId: string, kind: string, due: Date, link: string, assignment = false) => {
      if (!preferences.has(recipient)) return;
      planned.push({ recipientUserId: recipient, kind, sourceType, sourceId,
        triggerAt: assignment ? due : reminderAt(due, preferences.get(recipient)!),
        title: NOTIFICATION_TITLES[kind]!, link, dedupKey: notificationKey(recipient, sourceType, sourceId, kind, due) });
    };
    const tasks = await tx.task.findMany({ where: { status: { in: ["planned", "in_progress"] },
      NOT: { taskType: "showing_or_meeting", showingLinks: { some: {} } } },
      select: { id: true, responsibleUserId: true, dueAt: true, createdAt: true, taskType: true, recurrenceKind: true } });
    for (const t of tasks) {
      add(t.responsibleUserId, "task", t.id, taskNotificationKind(t), t.dueAt, `/tasks/${t.id}`);
      add(t.responsibleUserId, "task", t.id, "assignment", t.createdAt, `/tasks/${t.id}`, true);
    }
    const showings = await tx.showing.findMany({ where: { status: "planned" }, select: { id: true, responsibleUserId: true, scheduledAt: true } });
    for (const s of showings) add(s.responsibleUserId, "showing", s.id, "showing", s.scheduledAt, `/showings/${s.id}`);
    const agreements = await tx.agreement.findMany({ where: { archivedAt: null, status: { in: ["active", "signed"] }, validUntil: { not: null } },
      select: { id: true, responsibleUserId: true, validUntil: true } });
    for (const a of agreements) add(a.responsibleUserId, "agreement", a.id, "agreement",
      new Date(fromDateTimeLocalValue(`${a.validUntil!.toISOString().slice(0,10)}T00:00`, getConfig().APP_TIMEZONE)), `/agreements/${a.id}`);
    const events = await tx.calendarEvent.findMany({ where: { archivedAt: null }, select: { id: true, ownerUserId: true, startAt: true, endAt: true, recurrenceRule: true, createdAt: true } });
    for (const e of events) {
      const from = e.createdAt < e.startAt ? e.createdAt : e.startAt;
      const to = new Date(+now + ((preferences.get(e.ownerUserId) ?? 15) * 60000) + 86400000);
      for (const o of occurrences({ start: e.startAt.toISOString(), end: e.endAt.toISOString(), recurrenceRule: e.recurrenceRule }, from, to, getConfig().APP_TIMEZONE))
        add(e.ownerUserId, "calendar_event", e.id, "calendar_event", new Date(o.start), "/calendar");
    }
    await reconcilePending(tx, planned);
    const delivery = await tx.notification.updateMany({ where: { state: "pending", triggerAt: { lte: now },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }, data: { state: "delivered" } });
    return { active: true, locked: true, delivered: delivery.count };
  });
}

async function reconcilePending(tx: Tx, planned: Planned[]) {
  // A rescheduled/closed/deleted source must never deliver its old pending reminder.
  const desired = new Map(planned.map(p => [p.dedupKey, p]));
  const pending = await tx.notification.findMany({ where: { state: "pending" }, select: { id: true, dedupKey: true, snoozedUntil: true } });
  for (const p of pending) {
    const next = desired.get(p.dedupKey);
    if (!next) {
      await tx.notification.update({ where: { id: p.id }, data: { state: "dismissed" } });
    } else if (!p.snoozedUntil) {
      await tx.notification.update({ where: { id: p.id }, data: { triggerAt: next.triggerAt } });
    }
  }
  // PostgreSQL ON CONFLICT DO NOTHING, including terminal notifications after a restart.
  for (let offset = 0; offset < planned.length; offset += 500)
    await tx.notification.createMany({ data: planned.slice(offset, offset + 500), skipDuplicates: true });
}
