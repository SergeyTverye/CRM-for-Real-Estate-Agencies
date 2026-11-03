import { z } from "zod";
import { db } from "@/shared/db/client";
import { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, startOfDayInTz, todayAsDateOnly } from "@/shared/time";
import { ForbiddenError } from "@/shared/errors";
import { parseInput, zDateOnly, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { staleNeedWhere } from "@/modules/needs/application/need-queries";

/**
 * UC-11 GetManagerReport (FR-22, FR-28, ТЗ 25.2, 31.5, 37.13, 37.18, 40.6).
 * Показатели вычисляются из первичных событий (обращения, показы, StageHistory, задачи, сделки, КП),
 * вручную редактируемых агрегатов нет. Каждая цифра сопровождается ссылкой drill-down на исходный список.
 */

export const reportFiltersSchema = z.object({
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
  userId: zUuid.optional(),
  sourceCode: z.string().max(50).optional(),
});

export interface Metric {
  key: string;
  label: string;
  value: number;
  hint?: string;
  href?: string;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
  return sp.toString() ? `?${sp.toString()}` : "";
}

export async function getManagerReport(actor: Actor, raw: unknown = {}) {
  if (!isManager(actor)) throw new ForbiddenError("Отчёты доступны руководителю");
  const f = parseInput(reportFiltersSchema, raw);
  const cfg = getConfig();
  const tz = cfg.APP_TIMEZONE;
  const today = todayAsDateOnly(new Date(), tz);
  const fromDate = f.from ?? addDays(today, -29);
  const toDate = f.to ?? today;
  // Границы периода в часовом поясе экземпляра: [from 00:00, to+1 00:00).
  const from = startOfDayInTz(new Date(fromDate.getTime() + 12 * 3_600_000), tz);
  const to = startOfDayInTz(new Date(toDate.getTime() + 36 * 3_600_000), tz);
  const period = { gte: from, lt: to };
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);
  const user = f.userId;

  const leadWhere: Prisma.LeadRequestWhereInput = { occurredAt: period, ...(user ? { responsibleUserId: user } : {}), ...(f.sourceCode ? { sourceCode: f.sourceCode } : {}) };

  const [newRequests, bySourceRaw, byChannelRaw, unprocessed, requestsWithNeed] = await Promise.all([
    db.leadRequest.count({ where: leadWhere }),
    db.leadRequest.groupBy({ by: ["sourceCode"], where: leadWhere, _count: { _all: true }, orderBy: { _count: { sourceCode: "desc" } } }),
    db.leadRequest.groupBy({ by: ["channelCode"], where: leadWhere, _count: { _all: true }, orderBy: { _count: { channelCode: "desc" } } }),
    db.leadRequest.count({ where: { ...leadWhere, statusCode: "open" } }),
    db.leadRequest.findMany({ where: { ...leadWhere, clientNeedId: { not: null } }, select: { clientNeedId: true, occurredAt: true } }),
  ]);

  // Переход «обращение → показ»: потребности из обращений периода, по которым был показ после обращения.
  let requestToShowing = 0;
  if (requestsWithNeed.length) {
    const needIds = [...new Set(requestsWithNeed.map((r) => r.clientNeedId!))];
    const showings = await db.showing.findMany({ where: { clientNeedId: { in: needIds } }, select: { clientNeedId: true, scheduledAt: true } });
    const firstReq = new Map<string, Date>();
    for (const r of requestsWithNeed) {
      const prev = firstReq.get(r.clientNeedId!);
      if (!prev || r.occurredAt < prev) firstReq.set(r.clientNeedId!, r.occurredAt);
    }
    requestToShowing = [...firstReq.entries()].filter(([needId, at]) => showings.some((s) => s.clientNeedId === needId && s.scheduledAt >= at)).length;
  }

  const showingWhere: Prisma.ShowingWhereInput = { scheduledAt: period, ...(user ? { responsibleUserId: user } : {}) };
  const [showingsTotal, showingsByStatus, showingsByResult] = await Promise.all([
    db.showing.count({ where: showingWhere }),
    db.showing.groupBy({ by: ["status"], where: showingWhere, _count: { _all: true } }),
    db.showing.groupBy({ by: ["resultCode"], where: { ...showingWhere, status: "completed" }, _count: { _all: true } }),
  ]);

  const needUser = user ? { responsibleUserId: user } : {};
  const activeNeeds = await db.clientNeed.count({ where: { status: "active", ...needUser } });
  const activeWithNextAction = await db.clientNeed.count({ where: { status: "active", ...needUser, taskLinks: { some: { task: { status: { in: [...OPEN_TASK_STATUSES] } } } } } });
  const staleNeeds = await db.clientNeed.count({ where: { AND: [staleNeedWhere(new Date(Date.now() - cfg.NEED_INACTIVITY_DAYS * 86_400_000)), needUser] } });
  const needsClosedByReason = await db.needStageHistory.groupBy({
    by: ["reasonCode"],
    where: { occurredAt: period, toStatus: "closed", fromStatus: { not: "closed" }, ...(user ? { need: { responsibleUserId: user } } : {}) },
    _count: { _all: true },
  });

  const overdueWhere: Prisma.TaskWhereInput = { status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: new Date() }, ...(user ? { responsibleUserId: user } : {}) };
  const [overdue, overdueByUserRaw, openTasks] = await Promise.all([
    db.task.count({ where: overdueWhere }),
    db.task.groupBy({ by: ["responsibleUserId"], where: overdueWhere, _count: { _all: true } }),
    db.task.count({ where: { status: { in: [...OPEN_TASK_STATUSES] }, ...(user ? { responsibleUserId: user } : {}) } }),
  ]);

  const dealUser = user ? { responsibleUserId: user } : {};
  const [dealsOpened, dealsCompleted, dealsActive, commissionsReceived] = await Promise.all([
    db.deal.count({ where: { openedAt: period, ...dealUser } }),
    db.deal.count({ where: { status: "completed", closedAt: period, ...dealUser } }),
    db.deal.count({ where: { status: { notIn: ["completed", "cancelled"] }, ...dealUser } }),
    db.dealCommission.aggregate({ where: { status: { in: ["received", "partially_received"] }, receivedAt: period, ...(user ? { deal: { responsibleUserId: user } } : {}) }, _sum: { amount: true } }),
  ]);

  // Воронка после КП: отправленные в периоде → показ после отправки → сделка по объекту из КП.
  const offersSent = await db.commercialOffer.findMany({
    where: { sentAt: period, ...(user ? { responsibleUserId: user } : {}) },
    select: { id: true, sentAt: true, clientNeedId: true, items: { select: { propertyId: true } } },
  });
  let offersToShowing = 0;
  let offersToDeal = 0;
  for (const o of offersSent) {
    const propertyIds = o.items.map((i) => i.propertyId);
    if (await db.showing.count({ where: { clientNeedId: o.clientNeedId, scheduledAt: { gte: o.sentAt! } } })) offersToShowing++;
    if (await db.deal.count({ where: { propertyId: { in: propertyIds }, openedAt: { gte: o.sentAt! } } })) offersToDeal++;
  }

  const reactivated = await countReactivatedClients(from, to, cfg.REACTIVATION_GAP_DAYS, user);

  // Активность сотрудников (по первичным событиям периода).
  const users = await db.user.findMany({ where: user ? { id: user } : { isActive: true }, select: { id: true, displayName: true, roleCode: true }, orderBy: { displayName: "asc" } });
  const activity = [];
  for (const u of users) {
    const [reqs, comms, shows, tasksDone, deals] = await Promise.all([
      db.leadRequest.count({ where: { createdBy: u.id, occurredAt: period } }),
      db.communication.count({ where: { authorUserId: u.id, occurredAt: period } }),
      db.showing.count({ where: { responsibleUserId: u.id, status: "completed", occurredAt: period } }),
      db.task.count({ where: { responsibleUserId: u.id, status: "completed", completedAt: period } }),
      db.deal.count({ where: { responsibleUserId: u.id, openedAt: period } }),
    ]);
    activity.push({
      user: u,
      requests: reqs,
      communications: comms,
      showingsCompleted: shows,
      tasksCompleted: tasksDone,
      dealsOpened: deals,
      overdue: overdueByUserRaw.find((o) => o.responsibleUserId === u.id)?._count._all ?? 0,
    });
  }

  const p = { from: fromStr, to: toStr };
  const kpis: Metric[] = [
    { key: "newRequests", label: "Новые обращения", value: newRequests, href: `/requests${qs({ ...p, sourceCode: f.sourceCode, responsibleUserId: user })}` },
    { key: "unprocessedRequests", label: "Обращения без обработки", value: unprocessed, href: `/requests${qs({ ...p, unprocessed: "yes", responsibleUserId: user })}` },
    { key: "activeNeeds", label: "Активные потребности", value: activeNeeds, href: `/needs${qs({ status: "active", responsibleUserId: user })}` },
    { key: "staleNeeds", label: `Без движения ${cfg.NEED_INACTIVITY_DAYS} дн.`, value: staleNeeds, href: `/needs${qs({ stale: "yes", responsibleUserId: user })}` },
    { key: "showings", label: "Показы", value: showingsTotal, href: `/showings${qs({ ...p, responsibleUserId: user })}` },
    { key: "overdue", label: "Просроченные действия", value: overdue, href: `/tasks${qs({ view: "all", status: "open", responsibleUserId: user })}&overdueOnly=yes` },
    { key: "dealsOpened", label: "Открыто сделок", value: dealsOpened, href: `/deals${qs({ ...p, responsibleUserId: user })}` },
    { key: "dealsActive", label: "Сделки в работе", value: dealsActive, href: `/deals${qs({ open: "yes", responsibleUserId: user })}` },
    { key: "dealsCompleted", label: "Завершено сделок", value: dealsCompleted, href: `/deals${qs({ status: "completed", responsibleUserId: user })}` },
    { key: "reactivated", label: `Повторно активированные клиенты (пауза ${cfg.REACTIVATION_GAP_DAYS} дн.)`, value: reactivated },
  ];

  return {
    period: { from: fromStr, to: toStr, timeZone: tz },
    filters: { userId: user ?? null, sourceCode: f.sourceCode ?? null },
    kpis,
    requestsBySource: bySourceRaw.map((r) => ({ code: r.sourceCode, count: r._count._all, href: `/requests${qs({ ...p, sourceCode: r.sourceCode, responsibleUserId: user })}` })),
    requestsByChannel: byChannelRaw.map((r) => ({ code: r.channelCode, count: r._count._all })),
    funnel: {
      requests: newRequests,
      requestsWithNeed: new Set(requestsWithNeed.map((r) => r.clientNeedId)).size,
      requestToShowing,
      offersSent: offersSent.length,
      offersToShowing,
      offersToDeal,
      dealsOpened,
      dealsCompleted,
    },
    showings: {
      total: showingsTotal,
      byStatus: showingsByStatus.map((s) => ({ code: s.status, count: s._count._all, href: `/showings${qs({ ...p, status: s.status })}` })),
      byResult: showingsByResult.map((s) => ({ code: s.resultCode ?? "—", count: s._count._all })),
    },
    needs: {
      active: activeNeeds,
      activeWithNextAction,
      nextActionShare: activeNeeds ? Math.round((activeWithNextAction / activeNeeds) * 1000) / 10 : 100,
      stale: staleNeeds,
      closedByReason: needsClosedByReason.map((r) => ({ code: r.reasonCode ?? "—", count: r._count._all })),
    },
    tasks: { open: openTasks, overdue, overdueShare: openTasks ? Math.round((overdue / openTasks) * 1000) / 10 : 0 },
    commissionsReceived: commissionsReceived._sum.amount?.toString() ?? "0",
    activity,
    generatedAt: new Date(),
  };
}

/**
 * Повторно активированные клиенты (ТЗ 31.5): Client существовал до события, не имел LeadRequest, Communication,
 * нового/изменённого ClientNeed, NeedPropertyMatch, Showing или завершённой Task в течение REACTIVATION_GAP_DAYS
 * и затем получил новый LeadRequest или новую ClientNeed в периоде.
 */
export async function countReactivatedClients(from: Date, to: Date, gapDays: number, userId?: string): Promise<number> {
  const userFilter = userId ? Prisma.sql`AND c.responsible_user_id = ${userId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    WITH events AS (
      SELECT lr.client_id, lr.occurred_at AS at FROM lead_requests lr WHERE lr.client_id IS NOT NULL AND lr.occurred_at >= ${from} AND lr.occurred_at < ${to}
      UNION ALL
      SELECT n.client_id, n.opened_at AS at FROM client_needs n WHERE n.opened_at >= ${from} AND n.opened_at < ${to}
    ),
    first_event AS (SELECT client_id, min(at) AS at FROM events GROUP BY client_id)
    SELECT count(*)::bigint AS n
    FROM first_event fe
    JOIN clients c ON c.id = fe.client_id
    WHERE c.created_at < fe.at - make_interval(days => ${gapDays})
      ${userFilter}
      AND NOT EXISTS (SELECT 1 FROM lead_requests x WHERE x.client_id = fe.client_id AND x.occurred_at >= fe.at - make_interval(days => ${gapDays}) AND x.occurred_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM communications x WHERE x.client_id = fe.client_id AND x.occurred_at >= fe.at - make_interval(days => ${gapDays}) AND x.occurred_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM client_needs x WHERE x.client_id = fe.client_id AND ((x.opened_at >= fe.at - make_interval(days => ${gapDays}) AND x.opened_at < fe.at) OR (x.updated_at >= fe.at - make_interval(days => ${gapDays}) AND x.updated_at < fe.at)))
      AND NOT EXISTS (SELECT 1 FROM need_property_matches m JOIN client_needs x ON x.id = m.client_need_id WHERE x.client_id = fe.client_id AND m.offered_at >= fe.at - make_interval(days => ${gapDays}) AND m.offered_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM showings s JOIN client_needs x ON x.id = s.client_need_id WHERE x.client_id = fe.client_id AND s.scheduled_at >= fe.at - make_interval(days => ${gapDays}) AND s.scheduled_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM tasks t JOIN task_clients tc ON tc.task_id = t.id WHERE tc.client_id = fe.client_id AND t.completed_at >= fe.at - make_interval(days => ${gapDays}) AND t.completed_at < fe.at)
  `;
  return Number(rows[0]?.n ?? 0);
}
