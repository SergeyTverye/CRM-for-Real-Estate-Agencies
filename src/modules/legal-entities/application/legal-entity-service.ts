import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zRequiredText } from "@/shared/validation";
import { writeAudit } from "@/modules/audit/application/audit";
import { isManager, type Actor } from "@/modules/auth/domain/actor";

/**
 * Юридические субъекты предприятия (ИП/ООО, ТЗ 19.6, 37.10–37.11, 37.16).
 * Используются в сделках, договорах и КП. Записи не удаляются — только деактивируются,
 * чтобы сохранить ссылки исторических сделок и договоров.
 */

export interface LegalEntityDto {
  id: string;
  entityType: string;
  displayName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  usage: { deals: number; agreements: number; offers: number };
}

export interface LegalEntityBrief {
  id: string;
  entityType: string;
  displayName: string;
}

function requireManager(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError();
}

export async function listLegalEntities(actor: Actor): Promise<LegalEntityDto[]> {
  requireManager(actor);
  const rows = await db.legalEntity.findMany({
    orderBy: [{ isActive: "desc" }, { entityType: "asc" }, { displayName: "asc" }],
    include: { _count: { select: { deals: true, agreements: true, offers: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, usage: { deals: _count.deals, agreements: _count.agreements, offers: _count.offers } }));
}

/** Активные субъекты для выбора в формах (сделка, договор, КП) — доступно всем ролям. */
export async function listActiveLegalEntities(): Promise<LegalEntityBrief[]> {
  return db.legalEntity.findMany({
    where: { isActive: true },
    select: { id: true, entityType: true, displayName: true },
    orderBy: [{ entityType: "asc" }, { displayName: "asc" }],
  });
}

const createSchema = z.object({
  entityType: zCode("legalEntityType", "Выберите форму: ИП или ООО"),
  displayName: zRequiredText(300, "Укажите наименование"),
});

async function assertUniqueName(displayName: string, exceptId?: string) {
  const same = await db.legalEntity.findFirst({
    where: { displayName: { equals: displayName, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (same) throw new ValidationError(undefined, { displayName: ["Субъект с таким наименованием уже есть"] });
}

export async function createLegalEntity(actor: Actor, input: unknown): Promise<LegalEntityBrief> {
  requireManager(actor);
  const data = parseInput(createSchema, input);
  await assertUniqueName(data.displayName);
  return transaction(async (tx) => {
    const created = await tx.legalEntity.create({ data, select: { id: true, entityType: true, displayName: true } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "legal_entity.created", entityType: "LegalEntity", entityId: created.id, after: data });
    return created;
  });
}

const updateSchema = z.object({
  displayName: zRequiredText(300, "Укажите наименование").optional(),
  isActive: z.boolean().optional(),
});

/** Переименование и (де)активация. Форма ИП/ООО не меняется — она определяет смысл исторических документов. */
export async function updateLegalEntity(actor: Actor, id: string, input: unknown): Promise<LegalEntityBrief & { isActive: boolean }> {
  requireManager(actor);
  const data = parseInput(updateSchema, input);
  const before = await db.legalEntity.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  if (data.displayName !== undefined && data.displayName !== before.displayName) await assertUniqueName(data.displayName, id);
  if (data.isActive === false && before.isActive) {
    const active = await db.legalEntity.count({ where: { isActive: true } });
    if (active <= 1) throw new DomainError("LAST_ACTIVE_LEGAL_ENTITY", "Должен остаться хотя бы один активный юридический субъект");
  }
  return transaction(async (tx) => {
    const updated = await tx.legalEntity.update({
      where: { id },
      data,
      select: { id: true, entityType: true, displayName: true, isActive: true },
    });
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    if (data.displayName !== undefined && data.displayName !== before.displayName) {
      changedBefore.displayName = before.displayName;
      changedAfter.displayName = data.displayName;
    }
    if (data.isActive !== undefined && data.isActive !== before.isActive) {
      changedBefore.isActive = before.isActive;
      changedAfter.isActive = data.isActive;
    }
    if (Object.keys(changedAfter).length) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: changedAfter.isActive === undefined ? "legal_entity.renamed" : changedAfter.isActive ? "legal_entity.activated" : "legal_entity.deactivated",
        entityType: "LegalEntity",
        entityId: id,
        before: changedBefore,
        after: changedAfter,
      });
    }
    return updated;
  });
}
