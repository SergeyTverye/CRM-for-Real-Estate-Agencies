import { PROSPECTIVE_RESULTS } from "../domain/prospective";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zDateTime, zExpectedUpdatedAt, zOptText, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { advertisementReadScope, propertyReadScope, leadRequestScope, needScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { insertTask, nextActionSchema, resolveTaskResponsible } from "@/modules/tasks/application/task-service";
import {
  checkDuplicates,
  insertClient,
  loadAccessibleClient,
  newClientSchema,
  normalizeContacts,
  reactivateClientIfInactive,
  NEUTRAL_DUPLICATE_MESSAGE,
} from "@/modules/clients/application/client-service";
import { insertNeed, needParamsSchema } from "@/modules/needs/application/need-service";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";

/**
 * UC-01 RegisterIncomingRequest (FR-06, ТЗ 6.1, 40.1).
 * Факт обращения сохраняется всегда, даже без дальнейшей потребности.
 * Правило «чей объект, того и клиент»: для НОВОГО клиента с контекстом Property/Advertisement
 * Client, LeadRequest и новая ClientNeed получают ответственного объекта. Для СУЩЕСТВУЮЩЕГО клиента
 * ответственность не меняется автоматически. конфликт с ответственным объекта возвращается в ответе.
 */

const clientChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), clientId: zUuid }),
  z.object({ mode: z.literal("new"), client: newClientSchema }),
  z.object({ mode: z.literal("none") }),
]);

const outcomeSchema = z.discriminatedUnion("resultCode", [
  z.object({ resultCode: z.literal("new_need"), need: needParamsSchema, nextAction: nextActionSchema }),
  z.object({ resultCode: z.literal("linked_existing_need"), needId: zUuid, nextAction: nextActionSchema }),
  z.object({ resultCode: z.literal("one_off_service"), nextAction: nextActionSchema.optional() }),
  z.object({ resultCode: z.literal("no_followup") }),
  z.object({ resultCode: z.literal("invalid_or_spam") }),
]);

export const registerRequestSchema = z.object({
  occurredAt: zDateTime,
  callAt: zDateTime.optional(),
  externalListingId: zUuid.optional(),
  outcomeCode: zCode("callOutcome").optional(),
  channelCode: z.string().trim().min(1, "Укажите канал"),
  sourceCode: z.string().trim().min(1, "Укажите источник"),
  summary: zOptText(4000),
  rawContact: zOptText(300),
  propertyId: zUuid.optional(),
  advertisementId: zUuid.optional(),
  responsibleUserId: zUuid.optional(),
  client: clientChoiceSchema,
  outcome: outcomeSchema,
  /** Риелтор подтверждает передачу руководителю при совпадении контакта с чужим клиентом. */
  escalateDuplicate: z.boolean().default(false),
  /** Руководитель восстанавливает архивного клиента в рамках обращения. */
  restoreArchivedClient: z.boolean().default(false),
});

export type RegisterRequestInput = z.input<typeof registerRequestSchema>;

export interface RegisterRequestResult {
  requestId: string;
  clientId: string | null;
  needId: string | null;
  taskId: string | null;
  responsibleUserId: string;
  /** Клиент передан другому сотруднику по правилу «чей объект» — у регистрирующего риелтора может не быть доступа. */
  assignedToOther: boolean;
  /** Существующий клиент закреплён не за ответственным объекта (требует решения руководителя). */
  responsibleConflict: { propertyResponsible: string; clientResponsible: string } | null;
  escalated: boolean;
  duplicateWarnings: { clientId: string; displayName: string }[];
  clientReactivated: boolean;
}

async function firstActiveManager(tx: Tx): Promise<string> {
  const m = await tx.user.findFirst({ where: { roleCode: "manager", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!m) throw new ConflictError("NO_MANAGER", "Нет активного руководителя");
  return m.id;
}

export async function registerRequest(actor: Actor, input: unknown): Promise<RegisterRequestResult> {
  const d = parseInput(registerRequestSchema, input);
  await assertDictionaryCode("lead_channel", d.channelCode, "channelCode");
  await assertDictionaryCode("lead_source", d.sourceCode, "sourceCode");
  if (d.outcome.resultCode === "new_need") {
    await assertDictionaryCode("need_operation_type", d.outcome.need.operationType, "outcome.need.operationType");
    await assertDictionaryCode("property_type", d.outcome.need.propertyType, "outcome.need.propertyType");
  }
  if (["no_followup", "invalid_or_spam", "one_off_service"].includes(d.outcome.resultCode) && !d.summary) {
    throw new ValidationError("Укажите причину завершения обращения в кратком содержании", { summary: ["Укажите причину"] });
  }
  if (d.client.mode === "none" && (d.outcome.resultCode === "new_need" || d.outcome.resultCode === "linked_existing_need")) {
    throw new ValidationError("Для потребности нужен клиент", { client: ["Выберите или создайте клиента"] });
  }
  if (d.responsibleUserId && d.responsibleUserId !== actor.userId && !isManager(actor)) {
    throw new ForbiddenError("Ответственного назначает правило предприятия; изменить его может руководитель");
  }

  const expectedOutcome = d.outcome.resultCode === "new_need" || d.outcome.resultCode === "linked_existing_need" ? "prospective"
    : d.outcome.resultCode === "one_off_service" ? "one_time" : d.outcome.resultCode === "invalid_or_spam" ? "spam" : "one_time";
  if (d.outcomeCode && d.outcomeCode !== expectedOutcome && !(d.outcomeCode === "wrong" && expectedOutcome === "spam")) {
    throw new ValidationError("Результат звонка не соответствует решению по обращению", { outcomeCode: ["Проверьте результат"] });
  }
  if (d.callAt && +d.callAt !== +d.occurredAt) throw new ValidationError("Время звонка должно совпадать с временем обращения");
  const callFields = { callAt: d.callAt ?? (d.channelCode === "phone" ? d.occurredAt : null), externalListingId: d.externalListingId ?? null, outcomeCode: d.outcomeCode ?? expectedOutcome };
  return transaction(async (tx) => {
    const external = d.externalListingId ? await tx.externalListing.findUnique({ where: { id: d.externalListingId }, select: { id: true, propertyId: true } }) : null;
    if (d.externalListingId && !external) throw new NotFoundError("Внешнее объявление не найдено");
    if (d.responsibleUserId && !await tx.user.findFirst({ where: { id: d.responsibleUserId, isActive: true }, select: { id: true } })) throw new ValidationError("Ответственный недоступен");
    // Объектный контекст: Advertisement → его Property.
    let propertyId = d.propertyId ?? null;
    if (d.advertisementId) {
      const ad = await tx.advertisement.findUnique({ where: { id: d.advertisementId }, select: { propertyId: true } });
      if (!ad) throw new NotFoundError("Объявление не найдено");
      if (propertyId && propertyId !== ad.propertyId) throw new ValidationError(undefined, { advertisementId: ["Объявление относится к другому объекту"] });
      propertyId = ad.propertyId;
    }
    if (external?.propertyId) {
      if (propertyId && propertyId !== external.propertyId) throw new ValidationError("Внешнее объявление относится к другому объекту", { externalListingId: ["Выберите объявление этого объекта"] });
      propertyId = external.propertyId;
    }
    let propertyResponsible: string | null = null;
    if (propertyId) {
      const p = await tx.property.findUnique({ where: { id: propertyId }, select: { responsibleUserId: true } });
      if (!p) throw new NotFoundError("Объект не найден");
      propertyResponsible = p.responsibleUserId;
    }

    const result: RegisterRequestResult = {
      requestId: "",
      clientId: null,
      needId: null,
      taskId: null,
      responsibleUserId: actor.userId,
      assignedToOther: false,
      responsibleConflict: null,
      escalated: false,
      duplicateWarnings: [],
      clientReactivated: false,
    };

    // Ответственный по умолчанию для нового клиента/обращения без клиента.
    const defaultResponsible = isManager(actor) && d.responsibleUserId ? d.responsibleUserId : (propertyResponsible ?? actor.userId);
    let clientId: string | null = null;
    let responsibleUserId = defaultResponsible;
    let clientArchived = false;

    if (d.client.mode === "existing") {
      const client = await loadAccessibleClient(tx, actor, d.client.clientId);
      clientId = client.id;
      responsibleUserId = client.responsibleUserId; // текущий ответственный клиента сохраняется (ТЗ 40.1)
      if (propertyResponsible && propertyResponsible !== client.responsibleUserId) {
        result.responsibleConflict = { propertyResponsible, clientResponsible: client.responsibleUserId };
      }
      if (client.status === "archived") {
        if (d.restoreArchivedClient && isManager(actor)) {
          await tx.client.update({ where: { id: client.id }, data: { status: "active", archivedAt: null } });
          await writeAudit(tx, { actorUserId: actor.userId, action: "client.restored", entityType: "Client", entityId: client.id, before: { status: "archived" }, after: { status: "active", reason: "lead_request" } });
        } else clientArchived = true;
      }
    } else if (d.client.mode === "new") {
      const contacts = normalizeContacts(d.client.client.contacts);
      const check = await checkDuplicates(tx, actor, contacts.map((c) => c.normalizedValue ?? ""));
      if (check.foreignConflict) {
        if (!d.escalateDuplicate) throw new ConflictError("DUPLICATE_CONFLICT", NEUTRAL_DUPLICATE_MESSAGE);
        result.escalated = true;
      } else if (check.visible.length && !d.client.client.confirmDuplicate) {
        throw new ConflictError("PROBABLE_DUPLICATE", "Найден клиент с таким же контактом. Выберите его или подтвердите создание нового.", {
          candidates: check.visible,
        });
      } else {
        result.duplicateWarnings = check.visible.map((c) => ({ clientId: c.clientId, displayName: c.displayName }));
        const nc = d.client.client;
        clientId = (
          await insertClient(tx, actor.userId, { displayName: nc.displayName, clientKind: nc.clientKind, notes: nc.notes, responsibleUserId }, contacts, nc.contactPersons)
        ).id;
      }
    }

    // Эскалация: обращение сохраняется без клиента, руководитель получает задачу (без сведений о чужой карточке).
    if (result.escalated) {
      const managerId = await firstActiveManager(tx);
      const rawContact = d.client.mode === "new" ? d.client.client.contacts.map((c) => c.value).join(", ") : d.rawContact;
      const lr = await tx.leadRequest.create({
        data: {
          ...callFields,
          responsibleUserId: actor.userId,
          occurredAt: d.occurredAt,
          channelCode: d.channelCode,
          sourceCode: d.sourceCode,
          resultCode: d.outcome.resultCode,
          statusCode: "open",
          summary: d.summary,
          rawContact,
          propertyId,
          advertisementId: d.advertisementId ?? null,
          createdBy: actor.userId,
        },
        select: { id: true },
      });
      const task = await insertTask(
        tx,
        actor.userId,
        {
          title: "Решить конфликт дубля по обращению",
          description: `Контакт из обращения совпал с клиентом другого сотрудника. Обращение зарегистрировал(а) ${actor.displayName}. Откройте обращение и привяжите его к клиенту.`,
          taskType: "call_or_contact",
          priority: "high",
          dueAt: new Date(Date.now() + 4 * 3_600_000),
          responsibleUserId: managerId,
        },
        propertyId ? { propertyIds: [propertyId] } : {},
      );
      await writeAudit(tx, { actorUserId: actor.userId, action: "lead_request.duplicate_escalated", entityType: "LeadRequest", entityId: lr.id, after: { taskId: task.id } });
      return { ...result, requestId: lr.id, taskId: task.id, responsibleUserId: actor.userId };
    }

    if (clientId && !clientArchived) {
      result.clientReactivated = (await reactivateClientIfInactive(tx, clientId)) === "reactivated";
    }

    let needId: string | null = null;
    let taskId: string | null = null;
    const o = d.outcome;
    if (o.resultCode === "new_need") {
      if (clientArchived) throw new DomainError("CLIENT_ARCHIVED", "Клиент в архиве: потребность можно создать после восстановления клиента руководителем.");
      const created = await insertNeed(tx, actor, { ...o.need, clientId: clientId!, responsibleUserId, stage: "new" }, o.nextAction);
      needId = created.id;
      taskId = created.taskId;
    } else if (o.resultCode === "linked_existing_need") {
      const need = await tx.clientNeed.findFirst({ where: { id: o.needId, clientId: clientId!, ...needScope(actor) } });
      if (!need) throw new NotFoundError("Потребность не найдена у выбранного клиента");
      needId = need.id;
      if (o.nextAction) {
        const resp = await resolveTaskResponsible(tx, actor, o.nextAction.responsibleUserId, need.responsibleUserId);
        taskId = (await insertTask(tx, actor.userId, { ...o.nextAction, responsibleUserId: resp }, { needIds: [need.id], clientIds: [clientId!] })).id;
      }
    } else if (o.resultCode === "one_off_service" && o.nextAction) {
      const resp = await resolveTaskResponsible(tx, actor, o.nextAction.responsibleUserId, responsibleUserId);
      taskId = (await insertTask(tx, actor.userId, { ...o.nextAction, responsibleUserId: resp }, clientId ? { clientIds: [clientId] } : {})).id;
    }

    const statusCode = o.resultCode === "new_need" || o.resultCode === "linked_existing_need" ? "processed" : o.resultCode === "one_off_service" && taskId ? "processed" : "closed";
    const lr = await tx.leadRequest.create({
      data: {
        ...callFields,
        clientId,
        clientNeedId: needId,
        propertyId,
        advertisementId: d.advertisementId ?? null,
        responsibleUserId,
        occurredAt: d.occurredAt,
        channelCode: d.channelCode,
        sourceCode: d.sourceCode,
        resultCode: o.resultCode,
        statusCode,
        summary: d.summary,
        rawContact: d.rawContact ?? (d.client.mode === "new" ? d.client.client.contacts.map((c) => c.value).join(", ") : null),
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    if (needId) await assertNeedInvariants(tx, [needId]);
    await writeAudit(tx, { actorUserId: actor.userId, action: "lead_request.registered", entityType: "LeadRequest", entityId: lr.id,
      after: { responsibleUserId, propertyId, clientId, needId, outcomeCode: callFields.outcomeCode } });
    return {
      ...result,
      requestId: lr.id,
      clientId,
      needId,
      taskId,
      responsibleUserId,
      assignedToOther: responsibleUserId !== actor.userId,
    };
  });
}

const resolveSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  clientId: zUuid.optional(),
  statusCode: zCode("leadStatus").optional(),
  responsibleUserId: zUuid.optional(),
  comment: zOptText(2000),
  nextAction: nextActionSchema.optional(),
});

/** Руководитель разрешает обращение: привязывает к клиенту, назначает ответственного, меняет статус. */
export async function resolveRequest(actor: Actor, requestId: string, input: unknown): Promise<void> {
  const d = parseInput(resolveSchema, input);
  await transaction(async (tx) => {
    const lr = await tx.leadRequest.findFirst({ where: { id: requestId, ...leadRequestScope(actor) } });
    if (!lr) throw new NotFoundError();
    if ((d.clientId || d.responsibleUserId) && !isManager(actor)) throw new ForbiddenError("Привязку к клиенту и смену ответственного выполняет руководитель");
    const res = await tx.leadRequest.updateMany({ where: { id: requestId, updatedAt: d.expectedUpdatedAt }, data: { updatedAt: new Date() } });
    if (res.count === 0) throw new StaleUpdateError();
    const data: Record<string, unknown> = {};
    if (d.clientId) {
      const c = await tx.client.findUnique({ where: { id: d.clientId }, select: { id: true, responsibleUserId: true } });
      if (!c) throw new NotFoundError("Клиент не найден");
      data.clientId = c.id;
      if (!d.responsibleUserId) data.responsibleUserId = c.responsibleUserId;
      await reactivateClientIfInactive(tx, c.id);
    }
    if (d.responsibleUserId) data.responsibleUserId = d.responsibleUserId;
    if (d.statusCode) data.statusCode = d.statusCode;
    const status = d.statusCode ?? lr.statusCode;
    if (status === "closed" && d.statusCode && !d.comment) throw new ValidationError("Укажите причину завершения обращения", { comment: ["Укажите причину"] });
    if (PROSPECTIVE_RESULTS.includes(lr.resultCode) && status !== "closed") {
      if (!lr.clientNeedId) throw new ValidationError("Свяжите перспективное обращение с потребностью и назначьте следующее действие");
      const need = await tx.clientNeed.findFirst({ where: { id: lr.clientNeedId, ...needScope(actor) } });
      if (!need) throw new NotFoundError();
      if (d.nextAction) {
        const responsibleUserId = await resolveTaskResponsible(tx, actor, d.nextAction.responsibleUserId, need.responsibleUserId);
        await insertTask(tx, actor.userId, { ...d.nextAction, responsibleUserId }, { needIds: [need.id], clientIds: [need.clientId] });
      }
      if (["active", "paused"].includes(need.status) && !await tx.taskNeed.count({ where: { clientNeedId: need.id, task: { status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { gte: new Date() } } } })) throw new ConflictError("NEXT_ACTION_REQUIRED", "Для перспективного обращения назначьте следующее действие с ответственным и сроком");
      await assertNeedInvariants(tx, [need.id]);
    }
    // Комментарий решения руководителя хранится только в AuditLog: summary видит зарегистрировавший риелтор.
    await tx.leadRequest.update({ where: { id: requestId }, data });
    if (data.clientId || data.responsibleUserId || d.comment || d.statusCode) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "lead_request.resolved",
        entityType: "LeadRequest",
        entityId: requestId,
        before: { clientId: lr.clientId, responsibleUserId: lr.responsibleUserId },
        after: { clientId: data.clientId ?? lr.clientId, responsibleUserId: data.responsibleUserId ?? lr.responsibleUserId, statusCode: data.statusCode ?? lr.statusCode, comment: d.comment },
      });
    }
  });
}

/** Предпросмотр ответственного для формы обращения (правило «чей объект, того и клиент»). */
export async function previewResponsible(actor: Actor, opts: { propertyId?: string; advertisementId?: string }) {
  const d = parseInput(z.object({ propertyId: zUuid.optional(), advertisementId: zUuid.optional() }), opts);
  const propertyWhere = { AND: [propertyReadScope(actor), { archivedAt: null, status: { not: "archived" } }] };
  const select = { id: true, responsible: { select: { id: true, displayName: true } } } as const;
  let property = d.propertyId ? await db.property.findFirst({ where: { id: d.propertyId, ...propertyWhere }, select }) : null;
  if (d.propertyId && !property) throw new NotFoundError("Объект не найден");
  if (d.advertisementId) {
    const ad = await db.advertisement.findFirst({
      where: { AND: [advertisementReadScope(actor), { id: d.advertisementId, property: propertyWhere }] },
      select: { property: { select } },
    });
    if (!ad) throw new NotFoundError("Объявление не найдено");
    if (property && property.id !== ad.property.id) {
      throw new ValidationError(undefined, { advertisementId: ["Объявление относится к другому объекту"] });
    }
    property = ad.property;
  }
  if (!property?.responsible) return { responsible: { id: actor.userId, displayName: actor.displayName }, byPropertyRule: false };
  const responsible = isManager(actor) || property.responsible.id === actor.userId
    ? property.responsible
    : { id: "", displayName: "Ответственный объекта" };
  return { responsible, byPropertyRule: true };
}
