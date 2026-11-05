import { redactClientLink } from "@/modules/access/application/redact-client";
import { z } from "zod";
import { db, transaction, type DbOrTx, type Tx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId,
  parseInput,
  skipTake,
  zCode,
  zDateOnly,
  zDateTime,
  zExpectedUpdatedAt,
  zMoney,
  zOptDateOnly,
  zOptDateTime,
  zOptMoney,
  zOptText,
  zPagination,
  zUuid,
} from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, clientScope, dealScope, agreementScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { insertTask } from "@/modules/tasks/application/task-service";
import { advanceNeedStage, loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { postdealTemplatesFor } from "../domain/postdeal-templates";

/**
 * UC-07 OpenOrCloseDeal (FR-12, FR-13, ТЗ 17.5, 19.4, 29.7).
 * Обязательны Property, responsible, LegalEntity, status, opened_at и хотя бы один DealParty.
 * Комиссии — отдельные записи DealCommission (numeric, неизвестная сумма не заменяется нулём).
 * Закрытие сделки не архивирует Client и не уничтожает историю.
 */

const partySchema = z
  .object({
    clientId: zUuid.optional(),
    externalPartyName: zOptText(300),
    partyRole: zCode("dealPartyRole"),
    comment: zOptText(1000),
  })
  .refine((p) => p.clientId || p.externalPartyName, { message: "Выберите клиента или укажите внешнего участника", path: ["clientId"] });

const commissionSchema = z.object({
  amount: zMoney,
  status: zCode("commissionStatus").default("planned"),
  dueAt: zOptDateOnly,
  receivedAt: zOptDateTime,
  payerPartyIndex: z.number().int().min(0).max(20).optional(),
  comment: zOptText(1000),
});

const createSchema = z.object({
  propertyId: zUuid,
  legalEntityId: zUuid,
  responsibleUserId: zUuid.optional(),
  clientNeedId: zUuid.optional(),
  status: zCode("dealStatus").default("draft"),
  openedAt: zOptDateTime,
  dealPrice: zOptMoney,
  notes: zOptText(4000),
  parties: z.array(partySchema).min(1, "Добавьте хотя бы одного участника").max(20),
  commissions: z.array(commissionSchema).max(20).default([]),
});

async function assertLegalEntity(tx: DbOrTx, id: string) {
  const le = await tx.legalEntity.findUnique({ where: { id }, select: { isActive: true } });
  if (!le?.isActive) throw new ValidationError(undefined, { legalEntityId: ["Выберите действующее ИП/ООО"] });
}

async function assertPartyClients(tx: DbOrTx, actor: Actor, clientIds: string[]) {
  const ids = [...new Set(clientIds)];
  if (!ids.length) return;
  const n = await tx.client.count({ where: { id: { in: ids }, ...clientScope(actor) } });
  if (n !== ids.length) throw new NotFoundError("Клиент-участник не найден или недоступен");
}

export async function createDeal(actor: Actor, input: unknown): Promise<{ id: string }> {
  const d = parseInput(createSchema, input);
  return transaction(async (tx) => {
    const property = await tx.property.findUnique({ where: { id: d.propertyId }, select: { id: true } });
    if (!property) throw new NotFoundError("Объект не найден");
    await assertLegalEntity(tx, d.legalEntityId);
    await assertPartyClients(tx, actor, d.parties.flatMap((p) => (p.clientId ? [p.clientId] : [])));
    let responsibleUserId = actor.userId;
    if (d.responsibleUserId && d.responsibleUserId !== actor.userId) {
      if (!isManager(actor)) throw new ForbiddenError("Назначить другого ответственного может руководитель");
      const u = await tx.user.findUnique({ where: { id: d.responsibleUserId }, select: { isActive: true } });
      if (!u?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
      responsibleUserId = d.responsibleUserId;
    }
    const deal = await tx.deal.create({
      data: {
        propertyId: d.propertyId,
        legalEntityId: d.legalEntityId,
        responsibleUserId,
        status: d.status,
        openedAt: d.openedAt ?? new Date(),
        dealPrice: d.dealPrice,
        notes: d.notes,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    const partyIds: string[] = [];
    for (const p of d.parties) {
      const created = await tx.dealParty.create({
        data: { dealId: deal.id, clientId: p.clientId ?? null, externalPartyName: p.externalPartyName, partyRole: p.partyRole, comment: p.comment },
        select: { id: true },
      });
      partyIds.push(created.id);
    }
    for (const c of d.commissions) {
      await tx.dealCommission.create({
        data: {
          dealId: deal.id,
          amount: c.amount,
          status: c.status,
          dueAt: c.dueAt,
          receivedAt: c.receivedAt ?? (["received", "partially_received"].includes(c.status) ? new Date() : null),
          payerPartyId: c.payerPartyIndex !== undefined ? (partyIds[c.payerPartyIndex] ?? null) : null,
          comment: c.comment,
        },
      });
    }
    if (d.clientNeedId) {
      await loadAccessibleNeed(tx, actor, d.clientNeedId);
      await advanceNeedStage(tx, actor, d.clientNeedId, "deal", "auto:deal_opened");
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "deal.created",
      entityType: "Deal",
      entityId: deal.id,
      after: { propertyId: d.propertyId, legalEntityId: d.legalEntityId, responsibleUserId, status: d.status, dealPrice: d.dealPrice, commissions: d.commissions.map((c) => ({ amount: c.amount, status: c.status })) },
    });
    return deal;
  });
}

async function loadDeal(tx: DbOrTx, actor: Actor, id: string) {
  const deal = await tx.deal.findFirst({ where: { id, ...dealScope(actor) } });
  if (!deal) throw new NotFoundError();
  return deal;
}

function assertDealOpen(deal: { status: string }) {
  if (["completed", "cancelled"].includes(deal.status)) throw new DomainError("DEAL_CLOSED", "Сделка закрыта — состав участников не меняется");
}

function assertCanEditDeal(actor: Actor, deal: { responsibleUserId: string }) {
  if (!isManager(actor) && deal.responsibleUserId !== actor.userId) throw new ForbiddenError("Изменять сделку может ответственный или руководитель");
}

const updateSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  status: z.enum(["draft", "preliminary_agreement", "documents", "registration"]).optional(),
  legalEntityId: zUuid.optional(),
  dealPrice: zOptMoney,
  preliminaryAgreementAt: zOptDateTime,
  mainAgreementAt: zOptDateTime,
  registrationAt: zOptDateTime,
  notes: zOptText(4000),
  responsibleUserId: zUuid.optional(),
});

/** Изменение рабочей сделки (до закрытия). Изменения цены, юрлица, ответственного, статуса и дат — в AuditLog. */
export async function updateDeal(actor: Actor, id: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(updateSchema, input);
  return transaction(async (tx) => {
    const before = await loadDeal(tx, actor, id);
    assertCanEditDeal(actor, before);
    if (["completed", "cancelled"].includes(before.status)) throw new DomainError("DEAL_CLOSED", "Сделка закрыта — изменения не допускаются");
    if (d.responsibleUserId && d.responsibleUserId !== before.responsibleUserId && !isManager(actor)) throw new ForbiddenError("Сменить ответственного может руководитель");
    if (d.legalEntityId) await assertLegalEntity(tx, d.legalEntityId);
    const { expectedUpdatedAt, ...fields } = d;
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const res = await tx.deal.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data });
    if (res.count === 0) throw new StaleUpdateError();
    const changed = Object.keys(data).filter((k) => String((before as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? "") && k !== "notes");
    if (changed.length) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "deal.updated",
        entityType: "Deal",
        entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: Object.fromEntries(changed.map((k) => [k, (data as Record<string, unknown>)[k]])),
      });
    }
    return { id };
  });
}

export async function addDealParty(actor: Actor, dealId: string, input: unknown): Promise<{ id: string }> {
  const p = parseInput(partySchema, input);
  return transaction(async (tx) => {
    const deal = await loadDeal(tx, actor, dealId);
    assertCanEditDeal(actor, deal);
    assertDealOpen(deal);
    if (p.clientId) await assertPartyClients(tx, actor, [p.clientId]);
    const party = await tx.dealParty.create({ data: { dealId, clientId: p.clientId ?? null, externalPartyName: p.externalPartyName, partyRole: p.partyRole, comment: p.comment }, select: { id: true } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.party_added", entityType: "Deal", entityId: dealId, after: { partyId: party.id, partyRole: p.partyRole, clientId: p.clientId } });
    return party;
  });
}

export async function removeDealParty(actor: Actor, dealId: string, partyId: string): Promise<void> {
  await transaction(async (tx) => {
    const deal = await loadDeal(tx, actor, dealId);
    assertCanEditDeal(actor, deal);
    assertDealOpen(deal);
    const party = await tx.dealParty.findFirst({ where: { id: partyId, dealId }, include: { _count: { select: { commissions: true } } } });
    if (!party) throw new NotFoundError();
    if (party._count.commissions) throw new DomainError("PARTY_HAS_COMMISSIONS", "Участник указан плательщиком комиссии");
    if ((await tx.dealParty.count({ where: { dealId } })) <= 1) throw new DomainError("LAST_PARTY", "В сделке должен остаться хотя бы один участник");
    await tx.dealParty.delete({ where: { id: partyId } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.party_removed", entityType: "Deal", entityId: dealId, before: { partyId, partyRole: party.partyRole, clientId: party.clientId } });
  });
}

const commissionInputSchema = commissionSchema.omit({ payerPartyIndex: true }).extend({ payerPartyId: zUuid.nullish() });

export async function addCommission(actor: Actor, dealId: string, input: unknown): Promise<{ id: string }> {
  const c = parseInput(commissionInputSchema, input);
  return transaction(async (tx) => {
    const deal = await loadDeal(tx, actor, dealId);
    assertCanEditDeal(actor, deal);
    if (c.payerPartyId && !(await tx.dealParty.count({ where: { id: c.payerPartyId, dealId } }))) throw new ValidationError(undefined, { payerPartyId: ["Плательщик не из этой сделки"] });
    const created = await tx.dealCommission.create({
      data: { dealId, amount: c.amount, status: c.status, dueAt: c.dueAt, receivedAt: c.receivedAt ?? (["received", "partially_received"].includes(c.status) ? new Date() : null), payerPartyId: c.payerPartyId ?? null, comment: c.comment },
      select: { id: true },
    });
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.commission_added", entityType: "Deal", entityId: dealId, after: { commissionId: created.id, amount: c.amount, status: c.status, dueAt: c.dueAt } });
    return created;
  });
}

const commissionUpdateSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  amount: zMoney.optional(),
  status: zCode("commissionStatus").optional(),
  dueAt: zOptDateOnly,
  receivedAt: zOptDateTime,
  payerPartyId: zUuid.nullish(),
  comment: zOptText(1000),
});

export async function updateCommission(actor: Actor, dealId: string, commissionId: string, input: unknown): Promise<{ id: string }> {
  const c = parseInput(commissionUpdateSchema, input);
  return transaction(async (tx) => {
    const deal = await loadDeal(tx, actor, dealId);
    assertCanEditDeal(actor, deal);
    const before = await tx.dealCommission.findFirst({ where: { id: commissionId, dealId } });
    if (!before) throw new NotFoundError();
    const { expectedUpdatedAt, ...fields } = c;
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (data.status === "received" && !data.receivedAt && !before.receivedAt) data.receivedAt = new Date();
    const res = await tx.dealCommission.updateMany({ where: { id: commissionId, updatedAt: expectedUpdatedAt }, data });
    if (res.count === 0) throw new StaleUpdateError();
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "deal.commission_changed",
      entityType: "Deal",
      entityId: dealId,
      before: { commissionId, amount: before.amount, status: before.status, dueAt: before.dueAt, receivedAt: before.receivedAt },
      after: { commissionId, ...data },
    });
    return { id: commissionId };
  });
}

const postdealTaskSchema = z.object({
  subtypeCode: zCode("postdealSubtype"),
  title: z.string().trim().min(1).max(300),
  dueAt: zDateTime,
  responsibleUserId: zUuid.optional(),
  recurrenceKind: zCode("recurrenceKind").default("none"),
});

const closeSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  status: z.enum(["completed", "cancelled"]),
  closedAt: zOptDateTime,
  comment: zOptText(2000),
  postdealTasks: z.array(postdealTaskSchema).max(10).default([]),
});

async function defaultManagerId(tx: Tx): Promise<string> {
  const m = await tx.user.findFirst({ where: { roleCode: "manager", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!m) throw new DomainError("NO_MANAGER", "Нет активного руководителя для постсделочных задач");
  return m.id;
}

/**
 * Закрытие сделки: статус/дата + выбранные постсделочные задачи (task_type=postdeal, task_subtype_code).
 * Ответственный по умолчанию — руководитель; руководитель может явно выбрать другого сотрудника.
 */
export async function closeDeal(actor: Actor, dealId: string, input: unknown): Promise<{ id: string; taskIds: string[] }> {
  const d = parseInput(closeSchema, input);
  return transaction(async (tx) => {
    const deal = await loadDeal(tx, actor, dealId);
    assertCanEditDeal(actor, deal);
    if (["completed", "cancelled"].includes(deal.status)) throw new DomainError("DEAL_CLOSED", "Сделка уже закрыта");
    const res = await tx.deal.updateMany({
      where: { id: dealId, updatedAt: d.expectedUpdatedAt },
      data: { status: d.status, closedAt: d.closedAt ?? new Date(), notes: d.comment ? [deal.notes, `Закрытие: ${d.comment}`].filter(Boolean).join("\n") : deal.notes },
    });
    if (res.count === 0) throw new StaleUpdateError();
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.closed", entityType: "Deal", entityId: dealId, before: { status: deal.status }, after: { status: d.status, closedAt: d.closedAt ?? "now" } });

    const parties = await tx.dealParty.findMany({ where: { dealId, clientId: { not: null } }, select: { clientId: true } });
    const clientIds = [...new Set(parties.map((p) => p.clientId!))];
    const managerId = d.postdealTasks.length ? await defaultManagerId(tx) : null;
    const taskIds: string[] = [];
    for (const t of d.postdealTasks) {
      let responsibleUserId = managerId!;
      if (t.responsibleUserId && t.responsibleUserId !== managerId) {
        if (!isManager(actor) && t.responsibleUserId !== actor.userId) throw new ForbiddenError("Выбрать другого ответственного за постсделочную задачу может руководитель");
        const u = await tx.user.findUnique({ where: { id: t.responsibleUserId }, select: { isActive: true } });
        if (!u?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
        responsibleUserId = t.responsibleUserId;
      }
      const task = await insertTask(
        tx,
        actor.userId,
        { title: t.title, taskType: "postdeal", taskSubtypeCode: t.subtypeCode, dueAt: t.dueAt, responsibleUserId, recurrenceKind: t.recurrenceKind },
        { dealIds: [dealId], clientIds, propertyIds: [deal.propertyId] },
      );
      taskIds.push(task.id);
      await writeAudit(tx, { actorUserId: actor.userId, action: "task.postdeal_created", entityType: "Task", entityId: task.id, after: { dealId, taskSubtypeCode: t.subtypeCode, responsibleUserId } });
    }
    return { id: dealId, taskIds };
  });
}

// ───── Queries ─────

export const dealFiltersSchema = zPagination.extend({
  status: zCode("dealStatus").optional(),
  open: z.enum(["yes", "no"]).optional(),
  responsibleUserId: zUuid.optional(),
  legalEntityId: zUuid.optional(),
  propertyId: zUuid.optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listDeals(actor: Actor, raw: unknown) {
  const f = parseInput(dealFiltersSchema, raw);
  const and: Prisma.DealWhereInput[] = [dealScope(actor)];
  if (f.status) and.push({ status: f.status });
  if (f.open === "yes") and.push({ status: { notIn: ["completed", "cancelled"] } });
  if (f.open === "no") and.push({ status: { in: ["completed", "cancelled"] } });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.legalEntityId) and.push({ legalEntityId: f.legalEntityId });
  if (f.propertyId) and.push({ propertyId: f.propertyId });
  if (f.from) and.push({ openedAt: { gte: f.from } });
  if (f.to) and.push({ openedAt: { lt: new Date(f.to.getTime() + 86_400_000) } });
  if (f.q) and.push({ OR: [{ property: { addressText: { contains: f.q, mode: "insensitive" } } }, { parties: { some: { externalPartyName: { contains: f.q, mode: "insensitive" }, OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] });
  const where: Prisma.DealWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.deal.findMany({
      where,
      orderBy: { openedAt: "desc" },
      ...skipTake(f),
      include: {
        property: { select: { id: true, addressText: true } },
        responsible: { select: { id: true, displayName: true } },
        legalEntity: { select: { id: true, displayName: true, entityType: true } },
        parties: { select: { partyRole: true, externalPartyName: true, client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
        commissions: { select: { amount: true, status: true } },
      },
    }),
    db.deal.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      ...r,
      parties: r.parties.map((p) => ({ partyRole: p.partyRole, name: p.client ? (canSeeClient(actor, p.client) ? p.client.displayName : "Клиент (нет доступа)") : p.externalPartyName, clientId: p.client && canSeeClient(actor, p.client) ? p.client.id : null })),
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getDeal(actor: Actor, id: string) {
  assertRecordId(id);
  const deal = await db.deal.findFirst({
    where: { id, ...dealScope(actor) },
    include: {
      property: { select: { id: true, addressText: true, operationType: true, price: true } },
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      legalEntity: { select: { id: true, displayName: true, entityType: true } },
      parties: { orderBy: { createdAt: "asc" }, include: { client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
      commissions: { orderBy: { createdAt: "asc" }, include: { payer: { select: { id: true, partyRole: true, externalPartyName: true, client: { select: { displayName: true, responsibleUserId: true } } } } } },
      agreements: { where: { archivedAt: null, ...agreementScope(actor) }, select: { id: true, agreementType: true, status: true, agreementNumber: true, validUntil: true } },
    },
  });
  if (!deal) throw new NotFoundError();
  return {
    deal: {
      ...deal,
      commissions: deal.commissions.map((c) => ({ ...c, payer: c.payer ? { ...redactClientLink(actor, c.payer), externalPartyName: c.payer.client && !canSeeClient(actor, c.payer.client) ? null : c.payer.externalPartyName } : null })),
      parties: deal.parties.map((p) => ({ ...redactClientLink(actor, p), externalPartyName: p.client && !canSeeClient(actor, p.client) ? null : p.externalPartyName, comment: p.client && !canSeeClient(actor, p.client) ? null : p.comment, clientVisible: p.client ? canSeeClient(actor, p.client) : false })),
    },
    canEdit: isManager(actor) || deal.responsibleUserId === actor.userId,
    postdealTemplates: postdealTemplatesFor(deal.property.operationType),
  };
}
