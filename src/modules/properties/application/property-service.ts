import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import { ConflictError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, zCode, zExpectedUpdatedAt, zOptBool, zOptDecimal, zOptInt, zOptMoney, zOptText, zRequiredText, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canEditProperty, clientScope, ownerContactsScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { insertTask } from "@/modules/tasks/application/task-service";
import {
  assertNoDuplicates,
  checkDuplicates,
  insertClient,
  newClientSchema,
  normalizeContacts,
} from "@/modules/clients/application/client-service";

/**
 * Объекты недвижимости (FR-05, FR-27, FR-30, ТЗ 17.2, 40.3).
 * Каталог доступен всем для чтения. изменять может руководитель или ответственный риелтор.
 * Контакты собственника выдаются отдельно от карточки объекта (ownerContactsScope).
 */

const URL_RE = /^https?:\/\/[^\s]+$/i;

export const propertyFieldsSchema = z.object({
  propertyType: z.string().trim().min(1, "Выберите тип"),
  propertySubtype: z.string().trim().max(50).nullish().transform((v) => v || null),
  operationType: z.string().trim().min(1, "Выберите операцию"),
  sourceType: zCode("propertySourceType"),
  sourcePlatformCode: z.string().trim().max(50).nullish().transform((v) => v || null),
  sourceUrl: zOptText(1000).refine((v) => v === null || URL_RE.test(v), "Ссылка должна начинаться с http(s)://"),
  addressText: zRequiredText(500, "Укажите адрес"),
  district: zOptText(200),
  area: zOptDecimal,
  floor: zOptInt,
  floorsTotal: zOptInt,
  roomsCount: zOptInt,
  landArea: zOptDecimal,
  buildingArea: zOptDecimal,
  price: zOptMoney,
  commercialPurpose: z.string().trim().max(50).nullish().transform((v) => v || null),
  powerKw: zOptDecimal,
  parkingAvailable: zOptBool,
  hasTenant: zOptBool,
  status: zCode("propertyStatus").default("active"),
  description: zOptText(8000),
});

export type PropertyFields = z.infer<typeof propertyFieldsSchema>;

const PHONE_IN_TEXT_RE = /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;

async function validatePropertyDictionaries(p: Partial<PropertyFields>, prev?: Partial<PropertyFields>) {
  await assertDictionaryCode("property_type", p.propertyType, "propertyType", prev?.propertyType);
  await assertDictionaryCode("property_subtype", p.propertySubtype, "propertySubtype", prev?.propertySubtype);
  await assertDictionaryCode("property_operation_type", p.operationType, "operationType", prev?.operationType);
  await assertDictionaryCode("ad_platform", p.sourcePlatformCode, "sourcePlatformCode", prev?.sourcePlatformCode);
  await assertDictionaryCode("commercial_purpose", p.commercialPurpose, "commercialPurpose", prev?.commercialPurpose);
}

function assertNoPhoneInDescription(description: string | null | undefined) {
  // ТЗ 37.7: общие поля объекта не должны случайно содержать телефон собственника.
  if (description && PHONE_IN_TEXT_RE.test(description))
    throw new ValidationError(undefined, { description: ["Описание не должно содержать телефон — контакты собственника ведутся в блоке «Собственники»"] });
}

const createSchema = propertyFieldsSchema.extend({ responsibleUserId: zUuid.nullish() });

export async function createProperty(actor: Actor, input: unknown): Promise<{ id: string }> {
  const data = parseInput(createSchema, input);
  await validatePropertyDictionaries(data);
  assertNoPhoneInDescription(data.description);
  let responsibleUserId: string | null = actor.userId;
  if (data.responsibleUserId !== undefined && data.responsibleUserId !== actor.userId) {
    if (!isManager(actor)) throw new ForbiddenError("Назначить другого ответственного может только руководитель");
    responsibleUserId = data.responsibleUserId;
  }
  return db.property.create({ data: { ...data, responsibleUserId, createdBy: actor.userId }, select: { id: true } });
}

export async function loadEditableProperty(tx: DbOrTx, actor: Actor, propertyId: string) {
  assertRecordId(propertyId);
  const p = await tx.property.findUnique({ where: { id: propertyId } });
  if (!p) throw new NotFoundError();
  if (!canEditProperty(actor, p)) throw new ForbiddenError("Изменять объект может ответственный риелтор или руководитель");
  return p;
}

// status объявлен явно: default из схемы создания не должен срабатывать при частичном обновлении.
const updateSchema = propertyFieldsSchema
  .omit({ status: true })
  .partial()
  .extend({ status: zCode("propertyStatus").optional(), expectedUpdatedAt: zExpectedUpdatedAt });

export async function updateProperty(actor: Actor, propertyId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(updateSchema, input);
  return transaction(async (tx) => {
    const before = await loadEditableProperty(tx, actor, propertyId);
    await validatePropertyDictionaries(data, before as unknown as Partial<PropertyFields>);
    if (data.description !== undefined) assertNoPhoneInDescription(data.description);
    const { expectedUpdatedAt, ...fields } = data;
    const clean: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    // Решение об архивировании и восстановлении принимает руководитель (ТЗ 3.1, 27.1).
    if (clean.status && clean.status !== before.status && (clean.status === "archived" || before.status === "archived") && !isManager(actor))
      throw new ForbiddenError("Архивировать и восстанавливать объект может только руководитель");
    if (clean.status === "archived") clean.archivedAt = new Date();
    else if (clean.status && before.status === "archived") clean.archivedAt = null;
    const res = await tx.property.updateMany({ where: { id: propertyId, updatedAt: expectedUpdatedAt }, data: clean });
    if (res.count === 0) throw new StaleUpdateError();
    if (clean.status && clean.status !== before.status && (clean.status === "archived" || before.status === "archived")) {
      await writeAudit(tx, { actorUserId: actor.userId, action: "property.archive_status_changed", entityType: "Property", entityId: propertyId, before: { status: before.status }, after: { status: clean.status } });
    }
    return { id: propertyId };
  });
}

export async function reassignProperty(actor: Actor, propertyId: string, input: unknown): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Сменить ответственного может только руководитель");
  const data = parseInput(z.object({ responsibleUserId: zUuid.nullable() }), input);
  await transaction(async (tx) => {
    const p = await tx.property.findUnique({ where: { id: propertyId } });
    if (!p) throw new NotFoundError();
    if (data.responsibleUserId) {
      const u = await tx.user.findUnique({ where: { id: data.responsibleUserId }, select: { isActive: true } });
      if (!u?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
    }
    await tx.property.update({ where: { id: propertyId }, data: { responsibleUserId: data.responsibleUserId } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "property.responsible_changed",
      entityType: "Property",
      entityId: propertyId,
      before: { responsibleUserId: p.responsibleUserId },
      after: { responsibleUserId: data.responsibleUserId },
    });
  });
}

const ownerSchema = z.object({
  clientId: zUuid.optional(),
  newClient: newClientSchema.optional(),
  ownerRole: zOptText(100),
  ownershipShare: zOptDecimal.refine((v) => v === null || (Number(v) > 0 && Number(v) <= 1), "Доля — число от 0 до 1"),
  comment: zOptText(1000),
});

/** Привязка собственника (существующий доступный Client или новый с проверкой дублей). */
export async function addPropertyOwner(actor: Actor, propertyId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(ownerSchema, input);
  if (!data.clientId && !data.newClient) throw new ValidationError("Выберите клиента или создайте нового собственника");
  return transaction(async (tx) => {
    const property = await loadEditableProperty(tx, actor, propertyId);
    let clientId = data.clientId;
    if (clientId) {
      const c = await tx.client.findFirst({ where: { id: clientId, ...clientScope(actor) } });
      if (!c) throw new NotFoundError("Клиент не найден или недоступен");
    } else {
      const nc = data.newClient!;
      const contacts = normalizeContacts(nc.contacts);
      const check = await checkDuplicates(tx, actor, contacts.map((c) => c.normalizedValue ?? ""));
      assertNoDuplicates(check, nc.confirmDuplicate);
      const responsible = property.responsibleUserId ?? actor.userId;
      clientId = (await insertClient(tx, actor.userId, { displayName: nc.displayName, clientKind: nc.clientKind, notes: nc.notes, responsibleUserId: responsible }, contacts, nc.contactPersons)).id;
    }
    const exists = await tx.propertyOwner.findUnique({ where: { propertyId_clientId: { propertyId, clientId } } });
    if (exists) throw new ConflictError("OWNER_EXISTS", "Этот клиент уже указан собственником объекта");
    return tx.propertyOwner.create({
      data: { propertyId, clientId, ownerRole: data.ownerRole, ownershipShare: data.ownershipShare, comment: data.comment },
      select: { id: true },
    });
  });
}

export async function removePropertyOwner(actor: Actor, propertyId: string, ownerId: string): Promise<void> {
  await transaction(async (tx) => {
    await loadEditableProperty(tx, actor, propertyId);
    const o = await tx.propertyOwner.findFirst({ where: { id: ownerId, propertyId } });
    if (!o) throw new NotFoundError();
    await tx.propertyOwner.delete({ where: { id: ownerId } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "property.owner_removed", entityType: "Property", entityId: propertyId, before: { clientId: o.clientId } });
  });
}


const grantSchema = z.object({ userId: zUuid, comment: zOptText(1000) });

export async function grantOwnerContactAccess(actor: Actor, propertyId: string, input: unknown): Promise<{ id: string }> {
  if (!isManager(actor)) throw new ForbiddenError("Выдавать доступ к контактам собственника может только руководитель");
  const data = parseInput(grantSchema, input);
  return transaction(async (tx) => {
    const p = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true, responsibleUserId: true } });
    if (!p) throw new NotFoundError();
    const user = await tx.user.findUnique({ where: { id: data.userId }, select: { isActive: true, roleCode: true } });
    if (!user?.isActive) throw new ValidationError(undefined, { userId: ["Сотрудник не найден или деактивирован"] });
    if (user.roleCode === "manager") throw new ValidationError(undefined, { userId: ["Руководителю отдельный доступ не требуется"] });
    if (p.responsibleUserId === data.userId) throw new ValidationError(undefined, { userId: ["Ответственному риелтору доступ предоставлен по правилу ответственности"] });
    const active = await tx.propertyContactGrant.findFirst({ where: { propertyId, userId: data.userId, revokedAt: null } });
    if (active) return { id: active.id };
    const g = await tx.propertyContactGrant.create({ data: { propertyId, userId: data.userId, grantedBy: actor.userId, comment: data.comment }, select: { id: true } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "owner_contacts.granted", entityType: "Property", entityId: propertyId, after: { grantId: g.id, userId: data.userId, comment: data.comment } });
    return g;
  });
}

export async function revokeOwnerContactAccess(actor: Actor, propertyId: string, grantId: string): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Отзывать доступ может только руководитель");
  await transaction(async (tx) => {
    const g = await tx.propertyContactGrant.findFirst({ where: { id: grantId, propertyId } });
    if (!g) throw new NotFoundError();
    if (g.revokedAt) return;
    await tx.propertyContactGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "owner_contacts.revoked", entityType: "Property", entityId: propertyId, before: { grantId, userId: g.userId } });
  });
}

/** Риелтор просит доступ: задача руководителю (само разрешение выдаёт руководитель). */
export async function requestOwnerContactAccess(actor: Actor, propertyId: string): Promise<{ taskId: string }> {
  return transaction(async (tx) => {
    const p = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true, addressText: true } });
    if (!p) throw new NotFoundError();
    const allowed = await tx.property.count({ where: { id: propertyId, ...ownerContactsScope(actor) } });
    if (allowed) throw new ConflictError("ALREADY_GRANTED", "Доступ к контактам собственника уже есть");
    // Повторный запрос не плодит задачи: открытый запрос этого риелтора по объекту переиспользуется.
    const existing = await tx.task.findFirst({
      where: { createdBy: actor.userId, status: { in: ["planned", "in_progress"] }, title: { startsWith: "Запрос доступа к контактам собственника" }, propertyLinks: { some: { propertyId } } },
      select: { id: true },
    });
    if (existing) return { taskId: existing.id };
    const manager = await tx.user.findFirst({ where: { roleCode: "manager", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!manager) throw new ConflictError("NO_MANAGER", "Нет активного руководителя");
    const task = await insertTask(
      tx,
      actor.userId,
      {
        title: `Запрос доступа к контактам собственника: ${p.addressText}`,
        description: `Риелтор ${actor.displayName} запрашивает доступ к контактам собственника.`,
        taskType: "other",
        dueAt: new Date(Date.now() + 86_400_000),
        responsibleUserId: manager.id,
      },
      { propertyIds: [propertyId] },
    );
    return { taskId: task.id };
  });
}
