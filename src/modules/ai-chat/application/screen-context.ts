import { labelOf } from "@/shared/codebook";
import { dealChecklistTemplate } from "@/modules/deals/domain/checklist-template";
import type { Prisma } from "@/generated/prisma/client";
import { db, type DbOrTx } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope, needScope, taskScope, dealScope, agreementScope, showingScope } from "@/modules/access/domain/scopes";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { NotFoundError } from "@/shared/errors";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { getManagerReport } from "@/modules/reports/application/report-service";
import { MAX_ROWS, type ChatContext, type RecordLink } from "../domain/policy";

// Stronger than card visibility: AI may not reveal ANY linked foreign client.
const safeDeal = (actor: Actor): Prisma.DealWhereInput => actor.role === "manager" ? {} : ({ AND: [dealScope(actor), { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] });
const safeAgreement = (actor: Actor): Prisma.AgreementWhereInput => actor.role === "manager" ? {} : ({ AND: [agreementScope(actor), { OR: [{ clientId: null }, { client: clientScope(actor) }] }, { OR: [{ dealId: null }, { deal: safeDeal(actor) }] }] });
export async function checkScreenContext(actor: Actor, c: ChatContext, tx: DbOrTx = db) {
  let allowed = true;
  if (c.kind === "task") allowed = !!await tx.task.findFirst({ where: { id: c.id, AND: [taskScope(actor), safeTaskTextScope(actor)] }, select: { id: true } });
  if (c.kind === "deal") allowed = !!await tx.deal.findFirst({ where: { id: c.id, ...safeDeal(actor) }, select: { id: true } });
  if (c.kind === "agreement") allowed = !!await tx.agreement.findFirst({ where: { id: c.id, ...safeAgreement(actor) }, select: { id: true } });
  if (c.kind === "reports") allowed = actor.role === "manager";
  if (!allowed) throw new NotFoundError();
}
const taskSelect = { id: true, taskType: true, status: true, priority: true, dueAt: true } as const;
const needSelect = { id: true, clientId: true, operationType: true, propertyType: true, status: true, stage: true, areaMin: true, areaMax: true, budgetMin: true, budgetMax: true, updatedAt: true } as const;
/** Whitelist only. Identities, owner links, contacts and documents are NEVER selected.
 * Task title/description are isolated as untrusted_data and redacted at the provider boundary.
 * Bounded records are a sample, not totals; totals are explicitly counted.
 */
export async function assembleScreenContext(actor: Actor, c: ChatContext) {
  await checkScreenContext(actor, c);
  const links: RecordLink[] = [];
  const link = (id: string, path: string, label: string) => { links.push({ id, href: `/${path}/${id}`, label: `Открыть ${label}` }); return id; };
  const taskWhere = { AND: [taskScope(actor), safeTaskTextScope(actor)], status: { in: [...OPEN_TASK_STATUSES] } };
  let data: unknown = c;
  if (c.kind === "client" || c.kind === "need") {
    const need = c.kind === "need" ? await db.clientNeed.findFirst({ where: { id: c.id, AND: [needScope(actor), { client: clientScope(actor) }] }, select: needSelect }) : null;
    if (c.kind === "need" && !need) throw new NotFoundError();
    const client = await db.client.findFirst({ where: { id: need?.clientId ?? c.id, ...clientScope(actor) }, select: { id: true, status: true } });
    if (!client) throw new NotFoundError();
    link(client.id, "clients", "клиента");
    const needs = need ? [need] : await db.clientNeed.findMany({ where: { clientId: client.id, ...needScope(actor) }, select: needSelect, take: MAX_ROWS, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
    needs.forEach(n => link(n.id, "needs", "потребность"));
    const where = { ...taskWhere, OR: [{ clientLinks: { some: { clientId: client.id } } }, { needLinks: { some: { need: { clientId: client.id, ...(need ? { id: need.id } : {}) } } } }] };
    const tasks = await db.task.findMany({ where, select: taskSelect, take: MAX_ROWS, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
    tasks.forEach(t => link(t.id, "tasks", "задачу"));
    const communications = await db.communication.findMany({ where: { clientId: client.id, ...(need ? { clientNeedId: need.id } : {}) }, select: { communicationType: true, occurredAt: true, resultCode: true }, take: 5, orderBy: [{ occurredAt: "desc" }, { id: "asc" }] });
    const showings = await db.showing.findMany({ where: { AND: [showingScope(actor), { need: { clientId: client.id, ...(need ? { id: need.id } : {}) } }] }, select: { id: true, status: true, scheduledAt: true, resultCode: true }, take: 5, orderBy: [{ scheduledAt: "desc" }, { id: "asc" }] });
    showings.forEach(s => link(s.id, "showings", "показ"));
    const stages = await db.needStageHistory.findMany({ where: { need: { clientId: client.id, ...(need ? { id: need.id } : {}), ...needScope(actor) } }, select: { clientNeedId: true, fromStage: true, toStage: true, occurredAt: true }, take: 5, orderBy: [{ occurredAt: "desc" }, { id: "asc" }] });
    data = { ...c, client, needs: needs.map(n => ({ ...n, areaMin: n.areaMin?.toString(), areaMax: n.areaMax?.toString(), budgetMin: n.budgetMin?.toString(), budgetMax: n.budgetMax?.toString() })), tasks, openTaskCount: await db.task.count({ where }), communications, showings, stages, sampleLimit: MAX_ROWS };
  } else if (c.kind === "task") {
    const task = await db.task.findFirstOrThrow({ where: { id: c.id, AND: [taskScope(actor), safeTaskTextScope(actor)] }, select: { ...taskSelect, title: true, description: true,
      clientLinks: { where: { client: clientScope(actor) }, select: { clientId: true }, take: MAX_ROWS },
      needLinks: { where: { need: { AND: [needScope(actor), { client: clientScope(actor) }] } }, select: { clientNeedId: true }, take: MAX_ROWS },
      dealLinks: { where: { deal: safeDeal(actor) }, select: { dealId: true }, take: MAX_ROWS },
      agreementLinks: { where: { agreement: safeAgreement(actor) }, select: { agreementId: true }, take: MAX_ROWS },
      propertyLinks: { select: { propertyId: true }, take: MAX_ROWS },
    } });
    link(task.id, "tasks", "задачу");
    task.clientLinks.forEach(l => link(l.clientId, "clients", "клиента"));
    task.needLinks.forEach(l => link(l.clientNeedId, "needs", "потребность"));
    task.dealLinks.forEach(l => link(l.dealId, "deals", "сделку"));
    task.agreementLinks.forEach(l => link(l.agreementId, "agreements", "договор"));
    task.propertyLinks.forEach(l => link(l.propertyId, "properties", "объект"));
    const { title, description, ...facts } = task;
    // Free text is isolated as untrusted and filtered again at the provider boundary.
    data = { ...c, task: { ...facts, untrusted_data: { title, description } } };
  } else if (c.kind === "deal") {
    const deal = await db.deal.findFirstOrThrow({ where: { id: c.id, ...safeDeal(actor) }, select: { id: true, status: true, property: { select: { operationType: true } }, openedAt: true, preliminaryAgreementAt: true, mainAgreementAt: true, registrationAt: true, closedAt: true,
      parties: { select: { clientId: true, partyRole: true }, take: MAX_ROWS, orderBy: { id: "asc" } },
      checklistItems: { select: { code: true, status: true, checkedAt: true }, take: MAX_ROWS, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      taskLinks: { where: { task: taskWhere }, select: { task: { select: taskSelect } }, take: MAX_ROWS, orderBy: { task: { dueAt: "asc" } } },
    } });
    link(deal.id, "deals", "сделку");
    deal.parties.forEach(p => { if (p.clientId) link(p.clientId, "clients", "участника"); });
    deal.taskLinks.forEach(l => link(l.task.id, "tasks", "задачу"));
    const titles = new Map(dealChecklistTemplate(deal.property.operationType).map(item => [item.code, item.title]));
    data = { ...c, deal: { ...deal, checklistItems: deal.checklistItems.map(item => ({ ...item, label: titles.get(item.code) ?? "Проверка по сделке", statusLabel: labelOf("dealChecklistStatus", item.status) })) } };
  } else if (c.kind === "agreement") {
    const agreement = await db.agreement.findFirstOrThrow({ where: { id: c.id, ...safeAgreement(actor) }, select: { id: true, clientId: true, dealId: true, agreementType: true, status: true, signedAt: true, validFrom: true, validUntil: true, isExclusive: true } });
    link(agreement.id, "agreements", "договор");
    if (agreement.clientId) link(agreement.clientId, "clients", "клиента");
    if (agreement.dealId) link(agreement.dealId, "deals", "сделку");
    data = { ...c, agreement };
  } else if (c.kind === "today") {
    const where = { ...taskWhere, responsibleUserId: actor.userId };
    const tasks = await db.task.findMany({ where, select: taskSelect, take: MAX_ROWS, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
    tasks.forEach(t => link(t.id, "tasks", "задачу"));
    data = { ...c, tasks, openTaskCount: await db.task.count({ where }), overdueCount: await db.task.count({ where: { ...where, dueAt: { lt: new Date() } } }), sampleLimit: MAX_ROWS, scope: "my" };
  } else if (c.kind === "reports") {
    const report = await getManagerReport(actor);
    report.kpis.slice(0, MAX_ROWS).forEach(k => { if (k.href) links.push({ id: `report-${k.key}`, href: k.href, label: `Открыть: ${k.label}` }); });
    data = { ...c, period: report.period, metrics: report.kpis.map(k => ({ key: k.key, value: k.value })) };
  }
  return { data, links: [...new Map(links.map(l => [l.id, l])).values()] };
}
