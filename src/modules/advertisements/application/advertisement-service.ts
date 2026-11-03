import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, todayAsDateOnly } from "@/shared/time";
import { ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zExpectedUpdatedAt, zOptDateOnly, zOptDateTime, zOptText, zPagination, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { advertisementWriteScope, canEditProperty } from "@/modules/access/domain/scopes";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";

/**
 * Реклама (FR-16, ТЗ 37.12, 40.5): площадка (code), URL, рабочий текст, статус, даты публикации/проверки/окончания.
 * Автопубликация и API площадок вне MVP. last_checked_at обновляется пользователем при подтверждении актуальности.
 */

const URL_RE = /^https?:\/\/[^\s]+$/i;

const fieldsSchema = z.object({
  platformCode: z.string().trim().min(1, "Выберите площадку"),
  url: zOptText(1000).refine((v) => v === null || URL_RE.test(v), "Ссылка должна начинаться с http(s)://"),
  adText: zOptText(10000),
  status: zCode("advertisementStatus").default("active"),
  publishedAt: zOptDateTime,
  expiresAt: zOptDateOnly,
  comment: zOptText(2000),
});

const createSchema = fieldsSchema.extend({ propertyId: zUuid, responsibleUserId: zUuid.nullish() });

export async function createAdvertisement(actor: Actor, input: unknown): Promise<{ id: string }> {
  const d = parseInput(createSchema, input);
  await assertDictionaryCode("ad_platform", d.platformCode, "platformCode");
  return transaction(async (tx) => {
    const p = await tx.property.findUnique({ where: { id: d.propertyId }, select: { responsibleUserId: true } });
    if (!p) throw new NotFoundError("Объект не найден");
    if (!canEditProperty(actor, p)) throw new ForbiddenError("Рекламу объекта ведёт ответственный риелтор или руководитель");
    let responsibleUserId: string | null = p.responsibleUserId ?? actor.userId;
    if (d.responsibleUserId !== undefined && isManager(actor)) responsibleUserId = d.responsibleUserId;
    return tx.advertisement.create({
      data: {
        propertyId: d.propertyId,
        responsibleUserId,
        platformCode: d.platformCode,
        url: d.url,
        adText: d.adText,
        status: d.status,
        publishedAt: d.publishedAt ?? (d.status === "active" ? new Date() : null),
        lastCheckedAt: d.status === "active" ? new Date() : null,
        expiresAt: d.expiresAt,
        comment: d.comment,
      },
      select: { id: true },
    });
  });
}

const updateSchema = fieldsSchema
  .omit({ status: true })
  .partial()
  .extend({ status: zCode("advertisementStatus").optional(), expectedUpdatedAt: zExpectedUpdatedAt, markChecked: z.boolean().optional() });

export async function updateAdvertisement(actor: Actor, id: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(updateSchema, input);
  if (d.platformCode) await assertDictionaryCode("ad_platform", d.platformCode, "platformCode");
  return transaction(async (tx) => {
    const ad = await tx.advertisement.findFirst({ where: { id, ...advertisementWriteScope(actor) } });
    if (!ad) {
      if (await tx.advertisement.count({ where: { id } })) throw new ForbiddenError("Изменять объявление может ответственный или руководитель");
      throw new NotFoundError();
    }
    const { expectedUpdatedAt, markChecked, ...fields } = d;
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (markChecked) data.lastCheckedAt = new Date();
    if (data.status === "active" && !ad.publishedAt && !data.publishedAt) data.publishedAt = new Date();
    if (Object.keys(data).length === 0) throw new ValidationError("Нет изменений");
    const res = await tx.advertisement.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data });
    if (res.count === 0) throw new StaleUpdateError();
    return { id };
  });
}

// ───── Queries ─────

export const adFiltersSchema = zPagination.extend({
  status: zCode("advertisementStatus").optional(),
  platformCode: z.string().max(50).optional(),
  view: z.enum(["all", "expiring", "check_overdue", "expired"]).default("all"),
  responsibleUserId: zUuid.optional(),
  propertyId: zUuid.optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listAdvertisements(actor: Actor, raw: unknown) {
  const f = parseInput(adFiltersSchema, raw);
  const cfg = getConfig();
  const today = todayAsDateOnly(new Date(), cfg.APP_TIMEZONE);
  const and: Prisma.AdvertisementWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.platformCode) and.push({ platformCode: f.platformCode });
  if (f.view === "expiring") and.push({ status: "active", expiresAt: { gte: today, lte: addDays(today, 14) } });
  if (f.view === "expired") and.push({ OR: [{ status: "expired" }, { status: "active", expiresAt: { lt: today } }] });
  if (f.view === "check_overdue") and.push({ status: "active", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: addDays(new Date(), -cfg.AD_CHECK_INTERVAL_DAYS) } }] });
  if (f.responsibleUserId) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.propertyId) and.push({ propertyId: f.propertyId });
  if (f.q) and.push({ OR: [{ property: { addressText: { contains: f.q, mode: "insensitive" } } }, { adText: { contains: f.q, mode: "insensitive" } }, { url: { contains: f.q, mode: "insensitive" } }] });
  const where: Prisma.AdvertisementWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.advertisement.findMany({
      where,
      orderBy: [{ property: { addressText: "asc" } }, { status: "asc" }, { expiresAt: { sort: "asc", nulls: "last" } }],
      ...skipTake(f),
      include: {
        property: { select: { id: true, addressText: true, responsibleUserId: true } },
        responsible: { select: { id: true, displayName: true } },
      },
    }),
    db.advertisement.count({ where }),
  ]);
  const checkBefore = addDays(new Date(), -cfg.AD_CHECK_INTERVAL_DAYS);
  return {
    items: rows.map((r) => ({
      ...r,
      canEdit: isManager(actor) || r.responsibleUserId === actor.userId || r.property.responsibleUserId === actor.userId,
      checkOverdue: r.status === "active" && (!r.lastCheckedAt || r.lastCheckedAt < checkBefore),
      nextCheckAt: r.lastCheckedAt ? addDays(r.lastCheckedAt, cfg.AD_CHECK_INTERVAL_DAYS) : null,
      isExpired: r.expiresAt !== null && r.expiresAt < today,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getAdvertisement(actor: Actor, id: string) {
  assertRecordId(id);
  const ad = await db.advertisement.findUnique({
    where: { id },
    include: { property: { select: { id: true, addressText: true, responsibleUserId: true } }, responsible: { select: { id: true, displayName: true } } },
  });
  if (!ad) throw new NotFoundError();
  const canEdit = isManager(actor) || ad.responsibleUserId === actor.userId || ad.property.responsibleUserId === actor.userId;
  return { advertisement: ad, canEdit };
}
