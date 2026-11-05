import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor, isManager } from "@/modules/auth/domain/actor";
import { clientScope, needScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { NotFoundError, StaleUpdateError, ValidationError, ConflictError } from "@/shared/errors";
import { parseInput, zUuid, zExpectedUpdatedAt } from "@/shared/validation";
import { transferToCatalog, proposeListing, verifyListing } from "@/modules/property-search/application/listing-service";
import { proposeProperties } from "@/modules/matching/application/matching-service";
import { createOffer } from "@/modules/commercial-offers/application/offer-service";

export const collectionScope = (actor: Actor): Prisma.PropertyCollectionWhereInput => ({ OR: [{ ownerUserId: actor.userId }, { visibility: "team" }] });
const accessibleNeed = (actor: Actor): Prisma.ClientNeedWhereInput => ({ AND: [needScope(actor), { client: clientScope(actor) }] });
const audit = (tx: DbOrTx, actor: Actor, id: string, action: string, after?: unknown) => writeAudit(tx, { actorUserId: actor.userId, entityType: "PropertyCollection", entityId: id, action, after });
async function load(tx: DbOrTx, actor: Actor, id: string, write = false) {
  parseInput(zUuid, id);
  const row = await tx.propertyCollection.findFirst({ where: { id, ...collectionScope(actor), archivedAt: null }, include: { owner: { select: { displayName: true } } } });
  if (!row || (write && row.ownerUserId !== actor.userId && !isManager(actor))) throw new NotFoundError();
  return row;
}
async function touch(tx: DbOrTx, actor: Actor, id: string, expected?: Date) {
  await tx.$executeRaw`SELECT id FROM property_collections WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await load(tx, actor, id, true);
  if (expected && row.updatedAt.getTime() !== expected.getTime()) throw new StaleUpdateError();
  await tx.propertyCollection.update({ where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) } });
  return row;
}
export async function listCollections(actor: Actor, raw: unknown = {}) {
  const d = parseInput(z.object({ page: z.coerce.number().int().min(1).default(1), needId: zUuid.optional() }), raw);
  if (d.needId) await assertNeed(db, actor, d.needId);
  const where = { ...collectionScope(actor), archivedAt: null, ...(d.needId ? { needs: { some: { needId: d.needId } } } : {}) };
  const [items, total] = await Promise.all([db.propertyCollection.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (d.page - 1) * 30, take: 30, select: { id: true, name: true, visibility: true, owner: { select: { displayName: true } }, updatedAt: true, _count: { select: { items: true } } } }), db.propertyCollection.count({ where })]);
  return { items, total, page: d.page };
}
export async function createCollection(actor: Actor, raw: unknown) {
  const d = parseInput(z.object({ name: z.string().trim().min(1).max(200), visibility: z.enum(["private", "team"]).default("private") }).strict(), raw);
  return transaction(async tx => { const row = await tx.propertyCollection.create({ data: { ...d, ownerUserId: actor.userId } }); await audit(tx, actor, row.id, "collection_created", d); return { id: row.id }; });
}
async function assertNeed(tx: DbOrTx, actor: Actor, id: string) {
  const need = await tx.clientNeed.findFirst({ where: { id, ...accessibleNeed(actor) } });
  if (!need) throw new NotFoundError();
  return need;
}
export async function getCollection(actor: Actor, id: string) {
  const row = await load(db, actor, id);
  const hidden = await db.propertyCollectionNeed.count({ where: { collectionId: id, need: { NOT: accessibleNeed(actor) } } });
  const canReadNotes = hidden === 0;
  const [items, needs] = await Promise.all([
    db.propertyCollectionItem.findMany({ where: { collectionId: id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 1000,
      select: { id: true, externalListingId: true, propertyId: true, status: true, sortOrder: true, comment: canReadNotes, exclusionReason: canReadNotes, updatedAt: true,
        property: { select: { id: true, addressText: true, area: true, price: true, operationType: true, commercialPurpose: true, district: true, floor: true } },
        externalListing: { select: { id: true, address: true, url: true, source: true, propertyId: true, priceRub: true, priceUnit: true, areaM2: true, publishedAt: true, datePrecision: true, dateSource: true, purposes: true, district: true, floorRaw: true, pricePerM2Rub: true, pricePerM2Unit: true, firstSeenAt: true, lastCheckedAt: true,
          verifications: { orderBy: { verifiedAt: "desc" }, take: 1, select: { availability: true, verifiedAt: true } } } } } }),
    db.propertyCollectionNeed.findMany({ where: { collectionId: id, need: accessibleNeed(actor) }, select: { needId: true, need: { select: { operationType: true, propertyType: true, district: true, client: { select: { displayName: true } } } } } }),
  ]);
  return { ...row, canEdit: row.ownerUserId === actor.userId || isManager(actor), canReadNotes,
    items: items.map(i => ({ ...i, status: !canReadNotes && i.status === "proposed" ? (i.propertyId || i.externalListing?.propertyId ? "in_crm" : "in_collection") : i.status })), needs };
}
const itemRef = z.object({ externalListingId: zUuid.optional(), propertyId: zUuid.optional() }).strict().refine(d => Boolean(d.externalListingId) !== Boolean(d.propertyId), "Укажите объявление или объект CRM");
/** Search bulk contract: XOR refs, <=500; atomic, idempotent, ordered append; no Property/Match creation. */
export async function addItems(actor: Actor, collectionId: string, items: unknown) {
  const refs = parseInput(z.array(itemRef).min(1).max(500), items);
  return transaction(async tx => {
    await touch(tx, actor, collectionId);
    const count = await tx.propertyCollectionItem.count({ where: { collectionId } });
    let order = (await tx.propertyCollectionItem.aggregate({ where: { collectionId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1;
    let added = 0;
    for (const ref of refs) {
      if (ref.externalListingId && !await tx.externalListing.findUnique({ where: { id: ref.externalListingId }, select: { id: true } })) throw new NotFoundError();
      if (ref.propertyId && !await tx.property.findFirst({ where: { id: ref.propertyId, archivedAt: null }, select: { id: true } })) throw new NotFoundError();
      if (await tx.propertyCollectionItem.findFirst({ where: { collectionId, ...ref } })) continue;
      if (count + added >= 1000) throw new ValidationError("В подборке допускается не более 1000 элементов");
      await tx.propertyCollectionItem.create({ data: { collectionId, ...ref, sortOrder: ++order, addedBy: actor.userId, status: ref.propertyId ? "in_crm" : "in_collection" } }); added++;
    }
    await audit(tx, actor, collectionId, "collection_items_added", { added });
    return { added };
  });
}
export async function updateCollection(actor: Actor, id: string, raw: unknown) {
  const d = parseInput(z.object({ expectedUpdatedAt: zExpectedUpdatedAt, name: z.string().trim().min(1).max(200).optional(), visibility: z.enum(["private", "team"]).optional(), itemIds: z.array(zUuid).max(1000).optional() }).strict(), raw);
  return transaction(async tx => {
    await touch(tx, actor, id, d.expectedUpdatedAt);
    if (d.itemIds) {
      const all = await tx.propertyCollectionItem.findMany({ where: { collectionId: id }, select: { id: true } });
      if (new Set(d.itemIds).size !== all.length || d.itemIds.length !== all.length || all.some(i => !d.itemIds!.includes(i.id))) throw new ValidationError("Обновите полный состав подборки");
      for (const [sortOrder, itemId] of d.itemIds.entries()) await tx.propertyCollectionItem.update({ where: { id: itemId }, data: { sortOrder } });
    }
    await tx.propertyCollection.update({ where: { id }, data: { name: d.name, visibility: d.visibility } });
    await audit(tx, actor, id, "collection_updated", { name: d.name, visibility: d.visibility, reordered: !!d.itemIds }); return { id };
  });
}
export async function linkNeed(actor: Actor, id: string, raw: unknown) {
  const d = parseInput(z.object({ expectedUpdatedAt: zExpectedUpdatedAt, needId: zUuid, unlink: z.boolean().default(false) }).strict(), raw);
  return transaction(async tx => {
    await touch(tx, actor, id, d.expectedUpdatedAt); await assertNeed(tx, actor, d.needId);
    if (d.unlink) await tx.propertyCollectionNeed.deleteMany({ where: { collectionId: id, needId: d.needId } });
    else await tx.propertyCollectionNeed.upsert({ where: { collectionId_needId: { collectionId: id, needId: d.needId } }, create: { collectionId: id, needId: d.needId, linkedBy: actor.userId }, update: {} });
    await audit(tx, actor, id, d.unlink ? "collection_need_unlinked" : "collection_need_linked", { needId: d.needId }); return { id };
  });
}
export async function updateItem(actor: Actor, id: string, itemId: string, raw: unknown) {
  const d = parseInput(z.object({ expectedUpdatedAt: zExpectedUpdatedAt, status: z.enum(["in_collection", "check", "excluded"]).optional(), comment: z.string().trim().max(2000).nullable().optional(), exclusionReason: z.string().trim().max(2000).nullable().optional() }).strict(), raw);
  return transaction(async tx => {
    await touch(tx, actor, id);
    if (await tx.propertyCollectionNeed.count({ where: { collectionId: id, need: { NOT: accessibleNeed(actor) } } })) throw new NotFoundError();
    const item = await tx.propertyCollectionItem.findFirst({ where: { id: itemId, collectionId: id } }); if (!item) throw new NotFoundError();
    if ((d.status ?? item.status) === "excluded" && !(d.exclusionReason === undefined ? item.exclusionReason : d.exclusionReason)?.trim()) throw new ValidationError("Укажите причину исключения");
    const updated = await tx.propertyCollectionItem.updateMany({ where: { id: itemId, updatedAt: d.expectedUpdatedAt }, data: { status: d.status, comment: d.comment, exclusionReason: d.exclusionReason } });
    if (!updated.count) throw new StaleUpdateError();
    await audit(tx, actor, id, "collection_item_updated", { itemId, status: d.status }); return { id };
  });
}
export async function collectionItemAction(actor: Actor, id: string, itemId: string, raw: unknown) {
  const d = parseInput(z.object({ action: z.enum(["transfer", "propose", "verify"]), needId: zUuid.optional(), confirmed: z.boolean().optional(), identityConfirmed: z.boolean().optional(), availability: z.enum(["available", "reserved", "withdrawn", "unknown"]).optional() }).strict(), raw);
  await load(db, actor, id, true);
  const item = await db.propertyCollectionItem.findFirst({ where: { id: itemId, collectionId: id } }); if (!item) throw new NotFoundError();
  if (d.action === "transfer") {
    if (!item.externalListingId) throw new ValidationError("Объект уже в CRM");
    await transferToCatalog(actor, item.externalListingId, { confirmed: d.confirmed, identityConfirmed: d.identityConfirmed });
  } else if (d.action === "verify") {
    if (!item.externalListingId) throw new ValidationError("Проверка доступна для внешнего объявления");
    await verifyListing(actor, item.externalListingId, { availability: d.availability });
  } else {
    if (item.status === "excluded") throw new ValidationError("Сначала верните исключённый объект в подборку");
    if (!d.needId) throw new ValidationError("Выберите привязанную потребность");
    await assertNeed(db, actor, d.needId);
    if (!await db.propertyCollectionNeed.findUnique({ where: { collectionId_needId: { collectionId: id, needId: d.needId } } })) throw new NotFoundError();
    if (item.externalListingId) await proposeListing(actor, item.externalListingId, { needId: d.needId });
    else await proposeProperties(actor, d.needId, { propertyIds: [item.propertyId!] });
  }
  return transaction(async tx => { await touch(tx, actor, id); await tx.propertyCollectionItem.update({ where: { id: itemId }, data: { status: d.action === "transfer" ? "in_crm" : d.action === "propose" ? "proposed" : "check" } }); await audit(tx, actor, id, `collection_item_${d.action}`, { itemId }); return { id }; });
}
export async function collectionToOffer(actor: Actor, id: string, raw: unknown) {
  const d = parseInput(z.object({ needId: zUuid, itemIds: z.array(zUuid).min(1).max(30) }).strict(), raw);
  const card = await getCollection(actor, id); await assertNeed(db, actor, d.needId);
  if (!card.needs.some(n => n.needId === d.needId)) throw new NotFoundError();
  if (new Set(d.itemIds).size !== d.itemIds.length) throw new ValidationError("Элемент указан дважды");
  const items = card.items.filter(i => d.itemIds.includes(i.id));
  if (items.length !== d.itemIds.length) throw new NotFoundError();
  const properties = items.map(i => { if (i!.status === "excluded") throw new ValidationError("Исключённый объект нельзя включить в КП"); const propertyId = i!.propertyId ?? i!.externalListing?.propertyId; if (!propertyId) throw new ConflictError("PROPERTY_REQUIRED", "Сначала перенесите внешние объявления в каталог с подтверждением"); return { propertyId }; });
  const uniqueProperties = [...new Map(properties.map(p => [p.propertyId, p])).values()];
  if (await db.property.count({ where: { id: { in: uniqueProperties.map(p => p.propertyId) }, archivedAt: null } }) !== uniqueProperties.length) throw new NotFoundError();
  const offer = await createOffer(actor, { clientNeedId: d.needId, items: uniqueProperties });
  await audit(db, actor, id, "collection_offer_created", { offerId: offer.id }); return offer;
}
