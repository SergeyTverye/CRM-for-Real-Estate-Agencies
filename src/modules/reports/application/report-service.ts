import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, startOfDayInTz, todayAsDateOnly } from "@/shared/time";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zDateOnly, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { staleNeedWhere } from "@/modules/needs/application/need-queries";
import { PROSPECTIVE_RESULTS } from "@/modules/requests/domain/prospective";
import { listReactivatedClients } from "./reactivation-query";
export { countReactivatedClients } from "./reactivation-query";

export const reportFiltersSchema = z.object({ from: zDateOnly.optional(), to: zDateOnly.optional(), userId: zUuid.optional(), sourceCode: z.string().max(50).optional() });
export interface Metric { key: string; label: string; value: number; hint?: string; href?: string }
export interface DetailRow { id: string; label: string; href: string; amount?: string }
export function percent(n: number, total: number) { return total ? Math.round(n / total * 1000) / 10 : 100; }

export async function getManagerReport(actor: Actor, raw: unknown = {}) {
  if (!isManager(actor)) throw new ForbiddenError("Отчёты доступны руководителю");
  const f = parseInput(reportFiltersSchema, raw);
  const cfg = getConfig(), zone = cfg.APP_TIMEZONE;
  const now = new Date(), today = todayAsDateOnly(now, zone);
  const fromDate = f.from ?? addDays(today, -29), toDate = f.to ?? today;
  if (fromDate > toDate) throw new ValidationError("Начало периода позже окончания");
  const from = startOfDayInTz(new Date(fromDate.getTime() + 12 * 3600000), zone);
  const to = startOfDayInTz(new Date(toDate.getTime() + 36 * 3600000), zone);
  const period = { gte: from, lt: to };
  const p = { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
  const user = f.userId ? { responsibleUserId: f.userId } : {};
  const sourceNeed: Prisma.ClientNeedWhereInput = f.sourceCode ? { leadRequests: { some: { sourceCode: f.sourceCode, occurredAt: period } } } : {};
  const sourceClient: Prisma.ClientWhereInput = f.sourceCode ? { leadRequests: { some: { sourceCode: f.sourceCode, occurredAt: period } } } : {};
  const needWhere: Prisma.ClientNeedWhereInput = { ...user, ...sourceNeed };
  const taskWhere: Prisma.TaskWhereInput = { ...user, ...(f.sourceCode ? { OR: [{ needLinks: { some: { need: sourceNeed } } }, { clientLinks: { some: { client: sourceClient } } }] } : {}) };
  const dealWhere: Prisma.DealWhereInput = { ...user, ...(f.sourceCode ? { parties: { some: { client: sourceClient } } } : {}) };
  const [requests, needs, showings, offers, deals, tasks, commissions, closures, reactivated, stale] = await Promise.all([
    db.leadRequest.findMany({ where: { occurredAt: period, ...user, ...(f.sourceCode ? { sourceCode: f.sourceCode } : {}) }, select: { id: true, occurredAt: true, clientNeedId: true, statusCode: true, resultCode: true, sourceCode: true, channelCode: true, createdBy: true } }),
    db.clientNeed.findMany({ where: needWhere, select: { id: true, status: true, taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] } } }, select: { task: { select: { dueAt: true, taskType: true } } } } } }),
    db.showing.findMany({ where: { scheduledAt: period, ...user, need: sourceNeed }, select: { id: true, clientNeedId: true, scheduledAt: true, status: true, resultCode: true, responsibleUserId: true, occurredAt: true } }),
    db.commercialOffer.findMany({ where: { sentAt: period, ...user, need: sourceNeed }, select: { id: true, sentAt: true, clientNeedId: true, items: { select: { propertyId: true } } } }),
    db.deal.findMany({ where: dealWhere, select: { id: true, propertyId: true, status: true, openedAt: true, closedAt: true, responsibleUserId: true, parties: { select: { clientId: true } } } }),
    db.task.findMany({ where: taskWhere, select: { id: true, title: true, status: true, dueAt: true, completedAt: true, taskType: true, responsibleUserId: true } }),
    db.dealCommission.findMany({ where: { status: { in: ["received", "partially_received"] }, receivedAt: period, deal: dealWhere }, select: { id: true, dealId: true, amount: true } }),
    db.needStageHistory.findMany({ where: { occurredAt: period, toStatus: "closed", fromStatus: { not: "closed" }, need: needWhere }, select: { id: true, clientNeedId: true, reasonCode: true } }),
    listReactivatedClients(from, to, cfg.REACTIVATION_GAP_DAYS, f.userId, f.sourceCode),
    db.clientNeed.findMany({ where: { AND: [needWhere, staleNeedWhere(new Date(now.getTime() - cfg.NEED_INACTIVITY_DAYS * 86400000))] }, select: { id: true } }),
  ]);
  const inPeriod = (d: Date | null) => d !== null && d >= from && d < to;
  const row = (path: string, id: string, label = id): DetailRow => ({ id, label, href: `/${path}/${id}` });
  const leadRows = (rs: typeof requests) => rs.map(r => row("requests", r.id, `Обращение ${r.occurredAt.toISOString()}`));
  const needRows = (ids: string[]) => [...new Set(ids)].map(id => row("needs", id, "Потребность"));
  const taskRows = (ts: typeof tasks) => ts.map(t => row("tasks", t.id, t.title));
  const offerRows = (os: typeof offers) => os.map(o => row("offers", o.id, "Коммерческое предложение"));
  const dealRows = (ds: typeof deals) => ds.map(d => row("deals", d.id, "Сделка"));
  const isOpen = (s: string) => (OPEN_TASK_STATUSES as readonly string[]).includes(s);
  const openTasks = tasks.filter(t => isOpen(t.status));
  const overdue = openTasks.filter(t => t.dueAt < now);
  const active = needs.filter(n => n.status === "active");
  const activeWithNext = active.filter(n => n.taskLinks.length);
  const firstRequest = new Map<string, Date>();
  for (const r of requests) if (r.clientNeedId && (!firstRequest.has(r.clientNeedId) || r.occurredAt < firstRequest.get(r.clientNeedId)!)) firstRequest.set(r.clientNeedId, r.occurredAt);
  const linkedNeeds = await db.clientNeed.findMany({ where: { id: { in: [...new Set([...firstRequest.keys(), ...offers.map(o => o.clientNeedId)])] } }, select: { id: true, clientId: true, status: true, taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] } } }, select: { task: { select: { dueAt: true } } } } } });
  const prospective = requests.filter(r => PROSPECTIVE_RESULTS.includes(r.resultCode) && r.statusCode !== "closed" && (!r.clientNeedId || linkedNeeds.some(n => n.id === r.clientNeedId && ["active", "paused"].includes(n.status))));
  const covered = prospective.filter(r => linkedNeeds.some(n => n.id === r.clientNeedId && n.taskLinks.some(l => l.task.dueAt >= now)));
  const contacts = tasks.filter(t => ["call_or_contact", "pause_return"].includes(t.taskType) && t.status === "completed" && inPeriod(t.completedAt));
  const timely = contacts.filter(t => t.completedAt! <= t.dueAt);
  const cohorts: Record<string, DetailRow[]> = {
    newRequests: leadRows(requests), unprocessedRequests: leadRows(requests.filter(r => r.statusCode === "open")),
    activeNeeds: needRows(active.map(n => n.id)), activeWithNextAction: needRows(activeWithNext.map(n => n.id)),
    withoutNextAction: needRows(active.filter(n => !n.taskLinks.length).map(n => n.id)), staleNeeds: needRows(stale.map(n => n.id)),
    showings: showings.map(s => row("showings", s.id, "Показ")), overdue: taskRows(overdue), openTasks: taskRows(openTasks),
    dealsOpened: dealRows(deals.filter(d => inPeriod(d.openedAt))), dealsActive: dealRows(deals.filter(d => !["completed", "cancelled"].includes(d.status))),
    dealsCompleted: dealRows(deals.filter(d => d.status === "completed" && inPeriod(d.closedAt))),
    reactivated: reactivated.map(c => row("clients", c.id, c.label)),
    requestsWithNeed: needRows([...firstRequest.keys()]),
    requestToShowing: needRows([...firstRequest].filter(([id, at]) => showings.some(s => s.clientNeedId === id && s.scheduledAt >= at)).map(([id]) => id)),
    offersSent: offerRows(offers),
    offersToShowing: offerRows(offers.filter(o => showings.some(s => s.clientNeedId === o.clientNeedId && s.scheduledAt >= o.sentAt!))),
    offersToDeal: offerRows(offers.filter(o => deals.some(d => d.status === "completed" && inPeriod(d.closedAt) && d.closedAt! >= o.sentAt! && o.items.some(i => i.propertyId === d.propertyId) && linkedNeeds.some(n => n.id === o.clientNeedId && d.parties.some(p => p.clientId === n.clientId))))),
    prospective: leadRows(prospective), prospectiveWithAction: leadRows(covered), prospectiveWithoutAction: leadRows(prospective.filter(r => !covered.some(c => c.id === r.id))),
    contactsCompleted: taskRows(contacts), contactsOnTime: taskRows(timely),
    commissions: commissions.map(c => ({ ...row("deals", c.dealId, "Комиссия"), id: c.id, amount: c.amount.toString() })),
  };
  const href = (metric: string) => `/reports/detail?${new URLSearchParams({ ...p, ...(f.userId ? { userId: f.userId } : {}), ...(f.sourceCode ? { sourceCode: f.sourceCode } : {}), metric })}`;
  const group = <T,>(rs: T[], code: (r: T) => string, key: string, convert: (rs: T[]) => DetailRow[]) => [...new Set(rs.map(code))].map(c => {
    const metric = `${key}:${c}`; const rows = convert(rs.filter(r => code(r) === c)); cohorts[metric] = rows;
    return { code: c, count: rows.length, href: href(metric) };
  });
  const requestsBySource = group(requests, r => r.sourceCode, "source", leadRows);
  const requestsByChannel = group(requests, r => r.channelCode, "channel", leadRows);
  const byStatus = group(showings, s => s.status, "showingStatus", rs => rs.map(s => row("showings", s.id, "Показ")));
  const byResult = group(showings.filter(s => s.status === "completed"), s => s.resultCode ?? "—", "showingResult", rs => rs.map(s => row("showings", s.id, "Показ")));
  const closedByReason = group(closures, r => r.reasonCode ?? "—", "closure", rs => needRows(rs.map(r => r.clientNeedId)));
  const labels: Record<string, string> = { newRequests: "Новые обращения", unprocessedRequests: "Обращения без обработки", activeNeeds: "Активные потребности", staleNeeds: `Без движения ${cfg.NEED_INACTIVITY_DAYS} дн.`, showings: "Показы", overdue: "Просроченные действия", dealsOpened: "Открыто сделок", dealsActive: "Сделки в работе", dealsCompleted: "Завершено сделок", reactivated: `Повторно активированные клиенты (пауза ${cfg.REACTIVATION_GAP_DAYS} дн.)`, prospective: "Открытые перспективные обращения", prospectiveWithAction: "Перспективные с актуальным действием", contactsCompleted: "Завершённые контакты", contactsOnTime: "Контакты в срок", commissions: "Полученные комиссионные записи" };
  const kpis: Metric[] = Object.entries(labels).map(([key, label]) => ({ key, label, value: cohorts[key]!.length, href: href(key) }));
  const users = await db.user.findMany({ where: f.userId ? { id: f.userId } : { isActive: true }, select: { id: true, displayName: true, roleCode: true } });
  const activity = [];
  for (const u of users) {
    const communications = await db.communication.findMany({ where: { authorUserId: u.id, occurredAt: period, client: sourceClient }, select: { id: true, clientId: true } });
    const activityCohorts = {
      requests: leadRows(requests.filter(r => r.createdBy === u.id)), communications: communications.map(c => ({ ...row("clients", c.clientId, "Коммуникация"), id: c.id })),
      showingsCompleted: showings.filter(s => s.responsibleUserId === u.id && s.status === "completed" && inPeriod(s.occurredAt)).map(s => row("showings", s.id, "Показ")),
      tasksCompleted: taskRows(tasks.filter(t => t.responsibleUserId === u.id && t.status === "completed" && inPeriod(t.completedAt))),
      dealsOpened: dealRows(deals.filter(d => d.responsibleUserId === u.id && inPeriod(d.openedAt))), overdue: taskRows(overdue.filter(t => t.responsibleUserId === u.id)),
    };
    for (const [key, rows] of Object.entries(activityCohorts)) cohorts[`activity:${u.id}:${key}`] = rows;
    activity.push({ user: u, ...Object.fromEntries(Object.entries(activityCohorts).map(([k, v]) => [k, v.length])) as Record<keyof typeof activityCohorts, number> });
  }
  const count = (k: string) => cohorts[k]!.length;
  const commissionSum = commissions.reduce((sum, c) => sum + BigInt(c.amount.toFixed(2).replace(".", "")), 0n);
  return {
    period: { ...p, timeZone: zone }, filters: { userId: f.userId ?? null, sourceCode: f.sourceCode ?? null }, kpis,
    requestsBySource, requestsByChannel,
    funnel: { requests: count("newRequests"), requestsWithNeed: count("requestsWithNeed"), requestToShowing: count("requestToShowing"), offersSent: count("offersSent"), offersToShowing: count("offersToShowing"), offersToDeal: count("offersToDeal"), dealsOpened: count("dealsOpened"), dealsCompleted: count("dealsCompleted") },
    showings: { total: count("showings"), byStatus, byResult },
    needs: { active: active.length, activeWithNextAction: activeWithNext.length, nextActionShare: percent(activeWithNext.length, active.length), stale: stale.length, closedByReason },
    tasks: { open: openTasks.length, overdue: overdue.length, overdueShare: openTasks.length ? percent(overdue.length, openTasks.length) : 0 },
    contactControl: { prospective: prospective.length, withAction: covered.length, actionShare: percent(covered.length, prospective.length), completed: contacts.length, onTime: timely.length, onTimeShare: percent(timely.length, contacts.length) },
    commissionsReceived: `${commissionSum / 100n}.${String(commissionSum % 100n).padStart(2, "0")}`,
    activity, generatedAt: now, detailLinks: Object.fromEntries(Object.keys(cohorts).map(k => [k, href(k)])), cohorts,
  };
}
export async function getReportDetail(actor: Actor, metric: string, raw: unknown = {}) {
  const report = await getManagerReport(actor, raw);
  const rows = report.cohorts[metric];
  if (!rows) throw new NotFoundError();
  return { metric, period: report.period, filters: report.filters, rows, total: rows.length };
}
