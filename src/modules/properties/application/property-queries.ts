import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { addDays, todayAsDateOnly } from "@/shared/time";
import { NotFoundError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zPagination, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canEditProperty, canSeeClient, matchScope, ownerContactsScope, showingScope, agreementScope } from "@/modules/access/domain/scopes";

const decimalFilter = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/)
  .optional()
  .catch(undefined);

export const propertyFiltersSchema = zPagination.extend({
  q: z.string().trim().max(200).optional(),
  operationType: z.string().max(50).optional(),
  propertyType: z.string().max(50).optional(),
  propertySubtype: z.string().max(50).optional(),
  sourceType: zCode("propertySourceType").optional(),
  district: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "paused", "closed", "archived", "all", "working"]).default("working"),
  responsibleUserId: zUuid.optional(),
  mine: z.enum(["yes"]).optional(),
  areaMin: decimalFilter,
  areaMax: decimalFilter,
  priceMin: decimalFilter,
  priceMax: decimalFilter,
  roomsMin: z.coerce.number().int().min(0).max(100).optional().catch(undefined),
  advertising: z.enum(["active", "none", "expiring"]).optional(),
  sort: z.enum(["updated_desc", "price_asc", "price_desc", "area_desc", "address"]).default("updated_desc"),
});

export type PropertyFilters = z.output<typeof propertyFiltersSchema>;

export function propertyWhere(actor: Actor, f: Partial<PropertyFilters>): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [];
  if (f.status === "working" || !f.status) and.push({ status: { in: ["draft", "active", "paused"] } });
  else if (f.status !== "all") and.push({ status: f.status });
  if (f.operationType) and.push({ operationType: f.operationType });
  if (f.propertyType) and.push({ propertyType: f.propertyType });
  if (f.propertySubtype) and.push({ propertySubtype: f.propertySubtype });
  if (f.sourceType) and.push({ sourceType: f.sourceType });
  if (f.district) and.push({ district: { contains: f.district, mode: "insensitive" } });
  if (f.responsibleUserId) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.mine) and.push({ responsibleUserId: actor.userId });
  if (f.areaMin) and.push({ area: { gte: f.areaMin } });
  if (f.areaMax) and.push({ area: { lte: f.areaMax } });
  if (f.priceMin) and.push({ price: { gte: f.priceMin } });
  if (f.priceMax) and.push({ price: { lte: f.priceMax } });
  if (f.roomsMin !== undefined) and.push({ roomsCount: { gte: f.roomsMin } });
  if (f.q) and.push({ OR: [{ addressText: { contains: f.q, mode: "insensitive" } }, { district: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] });
  const today = todayAsDateOnly(new Date(), getConfig().APP_TIMEZONE);
  if (f.advertising === "active") and.push({ advertisements: { some: { status: "active" } } });
  if (f.advertising === "none") and.push({ advertisements: { none: { status: "active" } } });
  if (f.advertising === "expiring") and.push({ advertisements: { some: { status: "active", expiresAt: { lte: addDays(today, 14) } } } });
  return { AND: and };
}

export async function listProperties(actor: Actor, raw: unknown) {
  const f = parseInput(propertyFiltersSchema, raw);
  const where = propertyWhere(actor, f);
  const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
    f.sort === "price_asc"
      ? [{ price: { sort: "asc", nulls: "last" } }]
      : f.sort === "price_desc"
        ? [{ price: { sort: "desc", nulls: "last" } }]
        : f.sort === "area_desc"
          ? [{ area: { sort: "desc", nulls: "last" } }]
          : f.sort === "address"
            ? [{ addressText: "asc" }]
            : [{ updatedAt: "desc" }];
  const [rows, total] = await Promise.all([
    db.property.findMany({
      where,
      orderBy,
      ...skipTake(f),
      select: {
        id: true,
        addressText: true,
        district: true,
        propertyType: true,
        propertySubtype: true,
        operationType: true,
        sourceType: true,
        sourcePlatformCode: true,
        area: true,
        roomsCount: true,
        price: true,
        status: true,
        updatedAt: true,
        responsible: { select: { id: true, displayName: true } },
        advertisements: { where: { status: "active" }, select: { id: true, expiresAt: true }, orderBy: { expiresAt: "asc" }, take: 1 },
        agreements: { where: { status: "signed", archivedAt: null, ...agreementScope(actor) }, select: { id: true, validUntil: true }, take: 1 },
      },
    }),
    db.property.count({ where }),
  ]);
  return { items: rows, total, page: f.page, pageSize: f.pageSize };
}

export interface OwnerView {
  id: string;
  ownerRole: string | null;
  ownershipShare: string | null;
  client: { id: string; displayName: string; visible: boolean; contacts: { contactType: string; rawValue: string }[] } | null;
}

/**
 * Карточка объекта. Контакты собственника включаются в DTO только при праве (ТЗ 17.2):
 * руководитель, ответственный риелтор или действующий grant. Иначе — маскированное состояние.
 */
export async function getPropertyCard(actor: Actor, propertyId: string) {
  assertRecordId(propertyId);
  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: {
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      advertisements: { orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { responsible: { select: { displayName: true } } } },
      agreements: {
        where: { archivedAt: null, ...agreementScope(actor) },
        orderBy: { updatedAt: "desc" },
        include: { legalEntity: { select: { displayName: true } } },
      },
      matches: {
        where: matchScope(actor),
        orderBy: { offeredAt: "desc" },
        take: 50,
        include: { need: { select: { id: true, client: { select: { displayName: true, responsibleUserId: true } } } } },
      },
      showings: { where: showingScope(actor), orderBy: { scheduledAt: "desc" }, take: 50 },
      contactGrants: { where: { revokedAt: null }, include: { user: { select: { id: true, displayName: true } } } },
    },
  });
  if (!property) throw new NotFoundError();
  const canSeeOwners = (await db.property.count({ where: { id: propertyId, ...ownerContactsScope(actor) } })) > 0;
  const ownersRaw = await db.propertyOwner.findMany({
    where: { propertyId },
    include: {
      client: {
        select: {
          id: true,
          displayName: true,
          responsibleUserId: true,
          contacts: canSeeOwners ? { select: { contactType: true, rawValue: true }, orderBy: { isPrimary: "desc" } } : false,
        },
      },
    },
  });
  const owners: OwnerView[] = ownersRaw.map((o) => ({
    id: o.id,
    ownerRole: canSeeOwners ? o.ownerRole : null,
    ownershipShare: canSeeOwners && o.ownershipShare ? o.ownershipShare.toString() : null,
    client: canSeeOwners
      ? {
          id: o.client.id,
          displayName: o.client.displayName,
          visible: canSeeClient(actor, o.client),
          contacts: (o.client as unknown as { contacts?: { contactType: string; rawValue: string }[] }).contacts ?? [],
        }
      : null,
  }));
  const myGrant = property.contactGrants.find((g) => g.userId === actor.userId) ?? null;
  return {
    property: { ...property, contactGrants: isManager(actor) ? property.contactGrants : [] },
    owners,
    ownersCount: ownersRaw.length,
    canSeeOwners,
    canEdit: canEditProperty(actor, property),
    hasGrant: Boolean(myGrant),
    // Имя чужого клиента не попадает в ответ API (маскируется на сервере, а не только в UI).
    matches: property.matches.map((m) => {
      const clientVisible = canSeeClient(actor, m.need.client);
      return { ...m, need: { id: clientVisible ? m.need.id : null, client: { displayName: clientVisible ? m.need.client.displayName : null } }, clientVisible };
    }),
  };
}

export type PropertyCard = Awaited<ReturnType<typeof getPropertyCard>>;

/** Объекты для выбора в формах (обращение, подбор, сделка). */
export async function pickProperties(q: string | undefined, take = 20) {
  return db.property.findMany({
    where: { status: { in: ["draft", "active", "paused"] }, ...(q ? { addressText: { contains: q, mode: "insensitive" } } : {}) },
    select: { id: true, addressText: true, price: true, propertyType: true, operationType: true, responsible: { select: { id: true, displayName: true } } },
    orderBy: { updatedAt: "desc" },
    take,
  });
}

export async function distinctDistricts(): Promise<string[]> {
  const rows = await db.property.findMany({ where: { district: { not: null } }, distinct: ["district"], select: { district: true }, take: 200 });
  return rows.map((r) => r.district!).sort((a, b) => a.localeCompare(b, "ru"));
}
