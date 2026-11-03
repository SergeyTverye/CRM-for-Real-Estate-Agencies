import { z } from "zod";
import { transaction, type DbOrTx, type Tx } from "@/shared/db/client";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, zCode, zExpectedUpdatedAt, zOptText, zRequiredText, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { clientScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { normalizeContact, type ContactType } from "../domain/contact-normalization";

/**
 * UC-02 CreateOrUpdateClient (FR-01..FR-03, ТЗ 40.2, 40.2.2).
 * Дубли ищутся по нормализованному телефону/e-mail. Автоматического слияния нет.
 * Риелтору чужой Client не раскрывается: при совпадении возвращается нейтральный
 * конфликт без id, имени, ответственного и статуса. Руководитель видит кандидатов.
 */

export const contactInputSchema = z.object({
  contactType: zCode("contactType"),
  value: zRequiredText(200, "Укажите контакт"),
  isPrimary: z.boolean().default(false),
  comment: zOptText(500),
  contactPersonIndex: z.number().int().min(0).max(20).optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

const contactPersonSchema = z.object({
  fullName: zRequiredText(200),
  position: zOptText(200),
  isPrimary: z.boolean().default(false),
});

export const newClientSchema = z.object({
  displayName: zRequiredText(300, "Укажите имя или наименование"),
  clientKind: zCode("clientKind").default("person"),
  notes: zOptText(4000),
  contacts: z.array(contactInputSchema).max(20).default([]),
  contactPersons: z.array(contactPersonSchema).max(20).default([]),
  responsibleUserId: zUuid.optional(),
  confirmDuplicate: z.boolean().default(false),
});

export type NewClientInput = z.infer<typeof newClientSchema>;

export interface NormalizedContact extends ContactInput {
  normalizedValue: string | null;
}

export function normalizeContacts(contacts: ContactInput[]): NormalizedContact[] {
  const out: NormalizedContact[] = [];
  contacts.forEach((c, i) => {
    const normalizedValue = normalizeContact(c.contactType as ContactType, c.value);
    if (c.contactType !== "other" && !normalizedValue) {
      throw new ValidationError(undefined, {
        [`contacts.${i}.value`]: [c.contactType === "phone" ? "Некорректный номер телефона" : "Некорректный e-mail"],
      });
    }
    out.push({ ...c, normalizedValue });
  });
  if (out.length && !out.some((c) => c.isPrimary)) out[0]!.isPrimary = true;
  return out;
}

export interface DuplicateCandidate {
  clientId: string;
  displayName: string;
  status: string;
  responsible: { id: string; displayName: string };
  matchedValues: string[];
}

export interface DuplicateCheck {
  /** Кандидаты, которые actor вправе видеть (свои клиенты; руководителю — все). */
  visible: DuplicateCandidate[];
  /** Есть совпадение с клиентом, недоступным actor (только признак, без сведений). */
  foreignConflict: boolean;
}

/** Серверная проверка вероятных дублей по нормализованным контактам. */
export async function checkDuplicates(tx: DbOrTx, actor: Actor, normalizedValues: string[], excludeClientId?: string): Promise<DuplicateCheck> {
  const values = [...new Set(normalizedValues.filter(Boolean))];
  if (!values.length) return { visible: [], foreignConflict: false };
  const matches = await tx.clientContact.findMany({
    where: { normalizedValue: { in: values }, ...(excludeClientId ? { clientId: { not: excludeClientId } } : {}) },
    select: {
      normalizedValue: true,
      client: { select: { id: true, displayName: true, status: true, responsibleUserId: true, responsible: { select: { id: true, displayName: true } } } },
    },
  });
  const byClient = new Map<string, DuplicateCandidate>();
  let foreignConflict = false;
  for (const m of matches) {
    const visible = isManager(actor) || m.client.responsibleUserId === actor.userId;
    if (!visible) {
      foreignConflict = true;
      continue;
    }
    const existing = byClient.get(m.client.id);
    if (existing) existing.matchedValues.push(m.normalizedValue!);
    else
      byClient.set(m.client.id, {
        clientId: m.client.id,
        displayName: m.client.displayName,
        status: m.client.status,
        responsible: m.client.responsible,
        matchedValues: [m.normalizedValue!],
      });
  }
  return { visible: [...byClient.values()], foreignConflict };
}

export const NEUTRAL_DUPLICATE_MESSAGE =
  "Этот контакт уже зарегистрирован в CRM за другим сотрудником. Требуется решение руководителя: передайте обращение руководителю.";

/** Бросает конфликт дубля в зависимости от роли (используется клиентами и обращениями). */
export function assertNoDuplicates(check: DuplicateCheck, confirmDuplicate: boolean): void {
  if (check.foreignConflict) {
    throw new ConflictError("DUPLICATE_CONFLICT", NEUTRAL_DUPLICATE_MESSAGE);
  }
  if (check.visible.length && !confirmDuplicate) {
    throw new ConflictError("PROBABLE_DUPLICATE", "Найден клиент с таким же контактом. Выберите существующего клиента или подтвердите создание нового.", {
      candidates: check.visible,
    });
  }
}

async function resolveClientResponsible(tx: DbOrTx, actor: Actor, requested: string | undefined): Promise<string> {
  if (!requested || requested === actor.userId) return actor.userId;
  if (!isManager(actor)) throw new ForbiddenError("Назначить другого ответственного может только руководитель");
  const user = await tx.user.findUnique({ where: { id: requested }, select: { isActive: true } });
  if (!user?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
  return requested;
}

/**
 * Вставка клиента с контактами внутри транзакции вызывающей команды.
 * Проверка дублей выполняется ДО вызова (assertNoDuplicates).
 */
export async function insertClient(
  tx: Tx,
  createdBy: string,
  data: { displayName: string; clientKind: string; notes: string | null; responsibleUserId: string },
  contacts: NormalizedContact[],
  persons: z.infer<typeof contactPersonSchema>[] = [],
): Promise<{ id: string }> {
  const client = await tx.client.create({
    data: { ...data, status: "active", createdBy },
    select: { id: true },
  });
  const personIds: string[] = [];
  for (const p of persons) {
    const cp = await tx.clientContactPerson.create({ data: { ...p, clientId: client.id }, select: { id: true } });
    personIds.push(cp.id);
  }
  const seen = new Set<string>();
  for (const c of contacts) {
    const key = `${c.contactType}|${c.normalizedValue ?? c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.clientContact.create({
      data: {
        clientId: client.id,
        contactType: c.contactType,
        rawValue: c.value,
        normalizedValue: c.normalizedValue,
        isPrimary: c.isPrimary,
        comment: c.comment,
        contactPersonId: c.contactPersonIndex !== undefined ? (personIds[c.contactPersonIndex] ?? null) : null,
      },
    });
  }
  return client;
}

export async function createClient(actor: Actor, input: unknown): Promise<{ id: string }> {
  const data = parseInput(newClientSchema, input);
  const contacts = normalizeContacts(data.contacts);
  return transaction(async (tx) => {
    const check = await checkDuplicates(tx, actor, contacts.map((c) => c.normalizedValue ?? ""));
    assertNoDuplicates(check, data.confirmDuplicate);
    const responsibleUserId = await resolveClientResponsible(tx, actor, data.responsibleUserId);
    const client = await insertClient(
      tx,
      actor.userId,
      { displayName: data.displayName, clientKind: data.clientKind, notes: data.notes, responsibleUserId },
      contacts,
      data.contactPersons,
    );
    if (check.visible.length) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "client.created_despite_duplicate",
        entityType: "Client",
        entityId: client.id,
        after: { duplicateOf: check.visible.map((c) => c.clientId) },
      });
    }
    return client;
  });
}

/** Загрузка клиента с проверкой доступа (NotFound для чужого — не раскрывает существование). */
export async function loadAccessibleClient(tx: DbOrTx, actor: Actor, clientId: string) {
  assertRecordId(clientId);
  const client = await tx.client.findFirst({ where: { id: clientId, ...clientScope(actor) } });
  if (!client) throw new NotFoundError();
  return client;
}

const updateSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  displayName: zRequiredText(300).optional(),
  clientKind: zCode("clientKind").optional(),
  notes: zOptText(4000),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function updateClient(actor: Actor, clientId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(updateSchema, input);
  return transaction(async (tx) => {
    const client = await loadAccessibleClient(tx, actor, clientId);
    if (client.status === "archived") throw new DomainError("CLIENT_ARCHIVED", "Клиент в архиве. Восстановить его может руководитель.");
    const { expectedUpdatedAt, ...fields } = data;
    const res = await tx.client.updateMany({
      where: { id: clientId, updatedAt: expectedUpdatedAt },
      data: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    });
    if (res.count === 0) throw new StaleUpdateError();
    if (fields.status && fields.status !== client.status) {
      await writeAudit(tx, { actorUserId: actor.userId, action: "client.status_changed", entityType: "Client", entityId: clientId, before: { status: client.status }, after: { status: fields.status } });
    }
    return { id: clientId };
  });
}

export async function addClientContact(actor: Actor, clientId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(contactInputSchema.extend({ confirmDuplicate: z.boolean().default(false) }), input);
  const [contact] = normalizeContacts([data]);
  return transaction(async (tx) => {
    await loadAccessibleClient(tx, actor, clientId);
    if (contact!.normalizedValue) {
      const dup = await tx.clientContact.findFirst({ where: { clientId, contactType: contact!.contactType, normalizedValue: contact!.normalizedValue } });
      if (dup) throw new ValidationError(undefined, { value: ["Этот контакт уже есть в карточке"] });
      const check = await checkDuplicates(tx, actor, [contact!.normalizedValue], clientId);
      assertNoDuplicates(check, data.confirmDuplicate);
    }
    if (contact!.isPrimary) await tx.clientContact.updateMany({ where: { clientId, contactType: contact!.contactType }, data: { isPrimary: false } });
    const created = await tx.clientContact.create({
      data: {
        clientId,
        contactType: contact!.contactType,
        rawValue: contact!.value,
        normalizedValue: contact!.normalizedValue,
        isPrimary: contact!.isPrimary,
        comment: contact!.comment,
      },
      select: { id: true },
    });
    await tx.client.update({ where: { id: clientId }, data: { updatedAt: new Date() } });
    return created;
  });
}

export async function removeClientContact(actor: Actor, clientId: string, contactId: string): Promise<void> {
  await transaction(async (tx) => {
    await loadAccessibleClient(tx, actor, clientId);
    const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
    if (!contact) throw new NotFoundError();
    await tx.clientContact.delete({ where: { id: contactId } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "client.contact_removed",
      entityType: "Client",
      entityId: clientId,
      before: { contactType: contact.contactType, normalizedValue: contact.normalizedValue },
    });
  });
}

export async function addContactPerson(actor: Actor, clientId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(contactPersonSchema, input);
  return transaction(async (tx) => {
    await loadAccessibleClient(tx, actor, clientId);
    return tx.clientContactPerson.create({ data: { ...data, clientId }, select: { id: true } });
  });
}

const reassignSchema = z.object({
  responsibleUserId: zUuid,
  transferOpenNeeds: z.boolean().default(true),
  comment: zOptText(1000),
});

/**
 * Передача клиента другому сотруднику (только руководитель, ТЗ 40.1). Журналируется.
 * Незавершённые задачи автоматически НЕ передаются, чтобы не скрыть существующие обязательства.
 */
export async function reassignClient(actor: Actor, clientId: string, input: unknown): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Сменить ответственного может только руководитель");
  const data = parseInput(reassignSchema, input);
  await transaction(async (tx) => {
    const client = await loadAccessibleClient(tx, actor, clientId);
    const user = await tx.user.findUnique({ where: { id: data.responsibleUserId }, select: { isActive: true } });
    if (!user?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
    if (client.responsibleUserId === data.responsibleUserId) return;
    await tx.client.update({ where: { id: clientId }, data: { responsibleUserId: data.responsibleUserId } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "client.responsible_changed",
      entityType: "Client",
      entityId: clientId,
      before: { responsibleUserId: client.responsibleUserId },
      after: { responsibleUserId: data.responsibleUserId, comment: data.comment },
    });
    if (data.transferOpenNeeds) {
      const needs = await tx.clientNeed.findMany({
        where: { clientId, status: { in: ["active", "paused"] }, responsibleUserId: client.responsibleUserId },
        select: { id: true },
      });
      for (const n of needs) {
        await tx.clientNeed.update({ where: { id: n.id }, data: { responsibleUserId: data.responsibleUserId } });
        await writeAudit(tx, {
          actorUserId: actor.userId,
          action: "need.responsible_changed",
          entityType: "ClientNeed",
          entityId: n.id,
          before: { responsibleUserId: client.responsibleUserId },
          after: { responsibleUserId: data.responsibleUserId, reason: "client_transfer" },
        });
      }
    }
  });
}

/** Осознанное архивирование руководителем (ТЗ 40.2.2). Данные не удаляются. */
export async function archiveClient(actor: Actor, clientId: string, input: unknown): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Архивировать клиента может только руководитель");
  const data = parseInput(z.object({ comment: zOptText(1000) }), input ?? {});
  await transaction(async (tx) => {
    const client = await loadAccessibleClient(tx, actor, clientId);
    if (client.status === "archived") return;
    await tx.client.update({ where: { id: clientId }, data: { status: "archived", archivedAt: new Date() } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "client.archived",
      entityType: "Client",
      entityId: clientId,
      before: { status: client.status },
      after: { status: "archived", comment: data.comment },
    });
  });
}

export async function restoreClient(actor: Actor, clientId: string): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Восстановить клиента из архива может только руководитель");
  await transaction(async (tx) => {
    const client = await loadAccessibleClient(tx, actor, clientId);
    if (client.status !== "archived") return;
    await tx.client.update({ where: { id: clientId }, data: { status: "active", archivedAt: null } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "client.restored", entityType: "Client", entityId: clientId, before: { status: "archived" }, after: { status: "active" } });
  });
}

/**
 * Реактивация (ТЗ 40.2.2): новый LeadRequest или новая active ClientNeed переводят inactive Client в active
 * в той же бизнес-команде. Archived не восстанавливается автоматически.
 */
export async function reactivateClientIfInactive(tx: Tx, clientId: string): Promise<"active" | "reactivated" | "archived"> {
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { status: true } });
  if (client.status === "archived") return "archived";
  if (client.status === "inactive") {
    await tx.client.update({ where: { id: clientId }, data: { status: "active" } });
    return "reactivated";
  }
  return "active";
}
