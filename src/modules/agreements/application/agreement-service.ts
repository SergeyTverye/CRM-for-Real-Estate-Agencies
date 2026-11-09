import { redactClientLink } from "@/modules/access/application/redact-client";
import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, todayAsDateOnly } from "@/shared/time";
import { ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zExpectedUpdatedAt, zOptDateOnly, zOptMoney, zOptText, zPagination, zUuid, zOptBool } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { agreementScope, canEditProperty, canSeeClient, clientScope, taskScope, dealScope } from "@/modules/access/domain/scopes";
import { writeAudit, diffFields } from "@/modules/audit/application/audit";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { insertTask } from "@/modules/tasks/application/task-service";

/**
 * Договоры/соглашения (FR-32, ТЗ 29.14, 37.11, 40.4).
 * Срок и наличие договора не хранятся в комментарии: status, valid_until, причина отсутствия,
 * требуемое действие. Для signed от имени предприятия обязателен LegalEntity.
 */

const fieldsSchema = z.object({
  agreementType: zCode("agreementType"),
  status: zCode("agreementStatus"),
  agreementNumber: zOptText(100),
  isExclusive: zOptBool,
  signedAt: zOptDateOnly,
  validFrom: zOptDateOnly,
  validUntil: zOptDateOnly,
  legalEntityId: zUuid.nullish(),
  onBehalfOfCompany: z.boolean().default(true),
  commissionType: z.string().trim().max(50).nullish().transform((v) => v || null),
  commissionValue: zOptMoney,
  commissionNotes: zOptText(2000),
  absenceReasonCode: z.string().trim().max(50).nullish().transform((v) => v || null),
  actionRequired: zOptText(2000),
  notes: zOptText(4000),
});

type Fields = z.output<typeof fieldsSchema>;

/** Правила статуса signed и дат (используются при создании и изменении). */
function agreementRuleErrors(f: Partial<Fields>): Record<string, string[]> {
  const e: Record<string, string[]> = {};
  if (f.status === "signed" && !f.signedAt) e.signedAt = ["Для подписанного договора укажите дату подписания"];
  if (f.status === "signed" && f.onBehalfOfCompany !== false && !f.legalEntityId) e.legalEntityId = ["Выберите ИП/ООО, от имени которого подписан договор"];
  if (f.validFrom && f.validUntil && f.validFrom > f.validUntil) e.validUntil = ["Окончание раньше начала"];
  return e;
}

const createSchema = fieldsSchema
  .extend({
    clientId: zUuid.optional(),
    propertyId: zUuid.optional(),
    dealId: zUuid.optional(),
    responsibleUserId: zUuid.optional(),
    reminderDaysBefore: z.coerce.number().int().min(0).max(365).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.clientId && !d.propertyId && !d.dealId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Свяжите договор с клиентом, объектом или сделкой" });
    for (const [path, messages] of Object.entries(agreementRuleErrors(d))) for (const message of messages) ctx.addIssue({ code: "custom", path: [path], message });
  });

async function assertLinks(tx: DbOrTx, actor: Actor, d: { clientId?: string | null; propertyId?: string | null; dealId?: string | null }) {
  if (d.clientId && !(await tx.client.count({ where: { id: d.clientId, ...clientScope(actor) } }))) throw new NotFoundError("Клиент не найден или недоступен");
  if (d.propertyId) {
    const p = await tx.property.findUnique({ where: { id: d.propertyId }, select: { responsibleUserId: true } });
    if (!p) throw new NotFoundError("Объект не найден");
    if (!d.clientId && !d.dealId && !canEditProperty(actor, p)) throw new ForbiddenError("Договор по объекту ведёт ответственный риелтор или руководитель");
  }
  if (d.dealId && !(await tx.deal.count({ where: { id: d.dealId, ...dealScope(actor) } }))) throw new NotFoundError("Сделка не найдена или недоступна");
}

async function assertLegalEntity(tx: DbOrTx, id: string | null | undefined) {
  if (!id) return;
  const le = await tx.legalEntity.findUnique({ where: { id }, select: { isActive: true } });
  if (!le?.isActive) throw new ValidationError(undefined, { legalEntityId: ["Юридическое лицо не найдено или неактивно"] });
}

export async function createAgreement(actor: Actor, input: unknown): Promise<{ id: string; taskId: string | null }> {
  const d = parseInput(createSchema, input);
  await assertDictionaryCode("agreement_absence_reason", d.absenceReasonCode, "absenceReasonCode");
  await assertDictionaryCode("agreement_commission_type", d.commissionType, "commissionType");
  return transaction(async (tx) => {
    await assertLinks(tx, actor, d);
    await assertLegalEntity(tx, d.legalEntityId);
    const responsibleUserId = d.responsibleUserId && isManager(actor) ? d.responsibleUserId : actor.userId;
    const { onBehalfOfCompany: _o, reminderDaysBefore, ...data } = d;
    void _o;
    const a = await tx.agreement.create({
      data: { ...data, legalEntityId: d.legalEntityId ?? null, responsibleUserId },
      select: { id: true },
    });
    if (d.status === "signed") {
      await writeAudit(tx, { actorUserId: actor.userId, action: "agreement.signed", entityType: "Agreement", entityId: a.id, after: { legalEntityId: d.legalEntityId, validUntil: d.validUntil, signedAt: d.signedAt } });
    }
    let taskId: string | null = null;
    if (d.validUntil && reminderDaysBefore !== undefined) {
      const due = addDays(d.validUntil, -reminderDaysBefore);
      due.setUTCHours(9, 0, 0, 0);
      taskId = (
        await insertTask(
          tx,
          actor.userId,
          { title: `Проверить срок договора${d.agreementNumber ? ` № ${d.agreementNumber}` : ""}`, taskType: "contract_check", dueAt: due < new Date() ? new Date(Date.now() + 3_600_000) : due, responsibleUserId },
          { agreementIds: [a.id], ...(d.clientId ? { clientIds: [d.clientId] } : {}), ...(d.propertyId ? { propertyIds: [d.propertyId] } : {}), ...(d.dealId ? { dealIds: [d.dealId] } : {}) },
        )
      ).id;
    }
    return { id: a.id, taskId };
  });
}

async function loadAgreement(tx: DbOrTx, actor: Actor, id: string) {
  const a = await tx.agreement.findFirst({ where: { id, ...agreementScope(actor) } });
  if (!a) throw new NotFoundError();
  return a;
}

const updateSchema = fieldsSchema
  .partial()
  .extend({ expectedUpdatedAt: zExpectedUpdatedAt, onBehalfOfCompany: z.boolean().optional() });

export async function updateAgreement(actor: Actor, id: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(updateSchema, input);
  await assertDictionaryCode("agreement_absence_reason", d.absenceReasonCode, "absenceReasonCode");
  await assertDictionaryCode("agreement_commission_type", d.commissionType, "commissionType");
  return transaction(async (tx) => {
    const before = await loadAgreement(tx, actor, id);
    if (!isManager(actor) && before.responsibleUserId !== actor.userId) throw new ForbiddenError("Изменять договор может ответственный или руководитель");
    const { expectedUpdatedAt, onBehalfOfCompany, ...rest } = d;
    const merged = { ...before, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), onBehalfOfCompany: onBehalfOfCompany ?? true } as Partial<Fields>;
    const ruleErrors = agreementRuleErrors(merged);
    if (Object.keys(ruleErrors).length) throw new ValidationError(undefined, ruleErrors);
    await assertLegalEntity(tx, rest.legalEntityId);
    const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const res = await tx.agreement.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data });
    if (res.count === 0) throw new StaleUpdateError();
    const critical = diffFields(before as unknown as Record<string, unknown>, {
      status: rest.status,
      validUntil: rest.validUntil,
      signedAt: rest.signedAt,
      legalEntityId: rest.legalEntityId,
      isExclusive: rest.isExclusive,
    } as Record<string, unknown>);
    const changedKeys = Object.keys(critical.after).filter((k) => (rest as Record<string, unknown>)[k] !== undefined);
    if (changedKeys.length) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "agreement.critical_changed",
        entityType: "Agreement",
        entityId: id,
        before: Object.fromEntries(changedKeys.map((k) => [k, (critical.before as Record<string, unknown>)[k]])),
        after: Object.fromEntries(changedKeys.map((k) => [k, (critical.after as Record<string, unknown>)[k]])),
      });
    }
    return { id };
  });
}

export async function archiveAgreement(actor: Actor, id: string): Promise<void> {
  await transaction(async (tx) => {
    const a = await loadAgreement(tx, actor, id);
    if (!isManager(actor) && a.responsibleUserId !== actor.userId) throw new ForbiddenError();
    await tx.agreement.update({ where: { id }, data: { archivedAt: new Date(), status: "archived" } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "agreement.archived", entityType: "Agreement", entityId: id, before: { status: a.status } });
  });
}


export const agreementFiltersSchema = zPagination.extend({
  status: zCode("agreementStatus").optional(),
  agreementType: zCode("agreementType").optional(),
  view: z.enum(["all", "expiring", "expired", "absent", "action_required"]).default("all"),
  responsibleUserId: zUuid.optional(),
  legalEntityId: zUuid.optional(),
  clientId: zUuid.optional(),
  propertyId: zUuid.optional(),
  dealId: zUuid.optional(),
  includeArchived: z.enum(["yes"]).optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listAgreements(actor: Actor, raw: unknown) {
  const f = parseInput(agreementFiltersSchema, raw);
  const cfg = getConfig();
  const today = todayAsDateOnly(new Date(), cfg.APP_TIMEZONE);
  const and: Prisma.AgreementWhereInput[] = [agreementScope(actor)];
  if (!f.includeArchived) and.push({ archivedAt: null });
  if (f.status) and.push({ status: f.status });
  if (f.agreementType) and.push({ agreementType: f.agreementType });
  if (f.view === "expiring") and.push({ status: "signed", validUntil: { gte: today, lte: addDays(today, cfg.AGREEMENT_EXPIRY_WARNING_DAYS) } });
  if (f.view === "expired") and.push({ OR: [{ status: "expired" }, { status: "signed", validUntil: { lt: today } }] });
  if (f.view === "absent") and.push({ status: { in: ["no_agreement", "declined"] } });
  if (f.view === "action_required") and.push({ actionRequired: { not: null } });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.legalEntityId) and.push({ legalEntityId: f.legalEntityId });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.propertyId) and.push({ propertyId: f.propertyId });
  if (f.dealId) and.push({ dealId: f.dealId });
  if (f.q) and.push({ OR: [{ agreementNumber: { contains: f.q, mode: "insensitive" } }, { property: { addressText: { contains: f.q, mode: "insensitive" } } }, { client: { AND: [clientScope(actor), { displayName: { contains: f.q, mode: "insensitive" } }] } }] });
  const where: Prisma.AgreementWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.agreement.findMany({
      where,
      orderBy: [{ validUntil: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      ...skipTake(f),
      include: {
        client: { select: { id: true, displayName: true, responsibleUserId: true } },
        property: { select: { id: true, addressText: true } },
        deal: { select: { id: true } },
        responsible: { select: { id: true, displayName: true } },
        legalEntity: { select: { id: true, displayName: true, entityType: true } },
        taskLinks: { where: { task: { status: { in: ["planned", "in_progress"] }, ...taskScope(actor) } }, take: 1, orderBy: { task: { dueAt: "asc" } }, select: { task: { select: { id: true, title: true, dueAt: true } } } },
      },
    }),
    db.agreement.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      ...redactClientLink(actor, r),
      clientVisible: r.client ? canSeeClient(actor, r.client) : false,
      isExpired: r.status === "signed" && r.validUntil !== null && r.validUntil < today,
      expiresSoon: r.status === "signed" && r.validUntil !== null && r.validUntil >= today && r.validUntil <= addDays(today, cfg.AGREEMENT_EXPIRY_WARNING_DAYS),
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getAgreement(actor: Actor, id: string) {
  assertRecordId(id);
  const a = await db.agreement.findFirst({
    where: { id, ...agreementScope(actor) },
    include: {
      client: { select: { id: true, displayName: true, responsibleUserId: true } },
      property: { select: { id: true, addressText: true } },
      deal: { select: { id: true, status: true } },
      responsible: { select: { id: true, displayName: true } },
      legalEntity: { select: { id: true, displayName: true, entityType: true } },
    },
  });
  if (!a) throw new NotFoundError();
  return { agreement: redactClientLink(actor, a), clientVisible: a.client ? canSeeClient(actor, a.client) : false };
}
