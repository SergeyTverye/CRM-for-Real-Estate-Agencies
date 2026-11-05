import { displayLabel } from "@/shared/codebook";
import { z } from "zod";
import { cache } from "react";
import { db } from "@/shared/db/client";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zRequiredText } from "@/shared/validation";
import { writeAudit } from "@/modules/audit/application/audit";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { DICTIONARY_CATEGORIES, type DictionaryCategory } from "../domain/dictionary-data";

export interface DictionaryOption {
  value: string;
  label: string;
  isActive: boolean;
}

export type Dictionaries = Record<DictionaryCategory, DictionaryOption[]>;

/** Все бизнес-справочники (активные и неактивные — неактивные нужны для отображения истории). */
export const loadDictionaries = cache(async (): Promise<Dictionaries> => {
  const rows = await db.dictionaryItem.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { displayName: "asc" }] });
  const out = Object.fromEntries(Object.keys(DICTIONARY_CATEGORIES).map((k) => [k, [] as DictionaryOption[]])) as Dictionaries;
  for (const r of rows) {
    if (r.category in out) out[r.category as DictionaryCategory].push({ value: r.code, label: r.displayName, isActive: r.isActive });
  }
  return out;
});

export function dictLabel(dicts: Dictionaries, category: DictionaryCategory, code: string | null | undefined): string {
  if (!code) return "—";
  return dicts[category].find((o) => o.value === code)?.label ?? displayLabel(category, code);
}

/**
 * Проверка, что значение входит в активный справочник (для новых записей).
 * Для существующих записей допускается сохранение прежнего (деактивированного) кода.
 */
export async function assertDictionaryCode(category: DictionaryCategory, code: string | null | undefined, field: string, previous?: string | null): Promise<void> {
  if (code === null || code === undefined) return;
  if (previous !== undefined && previous === code) return;
  const item = await db.dictionaryItem.findUnique({ where: { category_code: { category, code } } });
  if (!item || !item.isActive) throw new ValidationError(undefined, { [field]: ["Значение отсутствует в справочнике"] });
}

const itemSchema = z.object({
  category: z.enum(Object.keys(DICTIONARY_CATEGORIES) as [DictionaryCategory, ...DictionaryCategory[]]),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,49}$/, "Код: латиница в нижнем регистре, цифры и _"),
  displayName: zRequiredText(200),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(100),
});

export async function listDictionaryItems(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError();
  return db.dictionaryItem.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { code: "asc" }] });
}

export async function createDictionaryItem(actor: Actor, input: unknown) {
  if (!isManager(actor)) throw new ForbiddenError();
  const data = parseInput(itemSchema, input);
  const exists = await db.dictionaryItem.findUnique({ where: { category_code: { category: data.category, code: data.code } } });
  if (exists) throw new ValidationError(undefined, { code: ["Код уже существует в справочнике"] });
  return db.$transaction(async (tx) => {
    const item = await tx.dictionaryItem.create({ data });
    await writeAudit(tx, { actorUserId: actor.userId, action: "dictionary.created", entityType: "DictionaryItem", entityId: item.id, after: data });
    return item;
  });
}

const updateSchema = z.object({
  displayName: zRequiredText(200).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
});

/** Код не меняется и не удаляется — только название, порядок и активность. */
export async function updateDictionaryItem(actor: Actor, id: string, input: unknown) {
  if (!isManager(actor)) throw new ForbiddenError();
  const data = parseInput(updateSchema, input);
  const before = await db.dictionaryItem.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  if (data.isActive === false) {
    const activeCount = await db.dictionaryItem.count({ where: { category: before.category, isActive: true } });
    if (activeCount <= 1) throw new DomainError("LAST_ACTIVE_ITEM", "В справочнике должно остаться хотя бы одно активное значение");
  }
  return db.$transaction(async (tx) => {
    const item = await tx.dictionaryItem.update({ where: { id }, data });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "dictionary.updated",
      entityType: "DictionaryItem",
      entityId: id,
      before: { displayName: before.displayName, isActive: before.isActive, sortOrder: before.sortOrder },
      after: data,
    });
    return item;
  });
}
