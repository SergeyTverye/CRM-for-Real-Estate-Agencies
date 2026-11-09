import { Prisma } from "@/generated/prisma/client";
import { lockSql } from "@/shared/db/dialect";
import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import { ConflictError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { parseInput, zUuid, zExpectedUpdatedAt } from "@/shared/validation";
import type { Actor } from "@/modules/auth/domain/actor";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { needScope } from "@/modules/access/domain/scopes";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { proposePropertiesInTransaction } from "@/modules/matching/application/matching-service";
import { createOffer, updateOffer } from "@/modules/commercial-offers/application/offer-service";
import { createTask } from "@/modules/tasks/application/task-service";
import { SearchFilters, PURPOSES, SOURCES } from "../domain/types";
import { guardExternalUrl } from "@/shared/net/ssrf";
import { jsonValue, searchAudit } from "./search-service";

async function listingById(id: string) {
  parseInput(zUuid, id);
  const listing = await db.externalListing.findUnique({ where: { id } });
  if (!listing) throw new NotFoundError();
  return listing;
}
const noteSchema = z.string().trim().max(2000).nullable().optional();
export async function setBookmark(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(z.object({ status: z.enum(["study", "clarify", "exclude"]), note: noteSchema }), input);
  await listingById(listingId);
  return transaction(async tx => {
    const row = await tx.searchBookmark.upsert({ where: { userId_listingId: { userId: actor.userId, listingId } },
      create: { userId: actor.userId, listingId, ...data }, update: data });
    await searchAudit(tx, actor, "bookmark", "SearchBookmark", row.id, { status: data.status });
    return row;
  });
}
export async function deleteBookmark(actor: Actor, id: string) {
  parseInput(zUuid, id);
  return transaction(async tx => {
    const row = await tx.searchBookmark.findFirst({ where: { id, userId: actor.userId } });
    if (!row) throw new NotFoundError();
    await tx.searchBookmark.delete({ where: { id: row.id } });
    await searchAudit(tx, actor, "bookmark_removed", "SearchBookmark", row.id);
    return { ok: true };
  });
}
export async function listBookmarks(actor: Actor) {
  return db.searchBookmark.findMany({ where: { userId: actor.userId }, orderBy: { updatedAt: "desc" }, take: 200, include: { listing: true } });
}
export async function setSelection(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(z.object({ needId: zUuid, comment: noteSchema, reviewStatus: z.enum(["candidate", "shortlisted", "rejected"]).default("candidate") }), input);
  await listingById(listingId);
  return transaction(async tx => {
    await loadAccessibleNeed(tx, actor, data.needId);
    const existing = await tx.searchSelection.findUnique({ where: { needId_listingId: { needId: data.needId, listingId } } });
    if (existing?.reviewStatus === "proposed") throw new ConflictError("ALREADY_PROPOSED", "Объект уже предложен клиенту. Измените реакцию в истории предложений.");
    const selection = await tx.searchSelection.upsert({ where: { needId_listingId: { needId: data.needId, listingId } },
      create: { ...data, listingId, addedBy: actor.userId }, update: { comment: data.comment, reviewStatus: data.reviewStatus } });
    await assertNeedInvariants(tx, [data.needId]);
    await searchAudit(tx, actor, "selection", "SearchSelection", selection.id, { reviewStatus: data.reviewStatus });
    return selection;
  });
}
export async function listSelections(actor: Actor, needId: string) {
  await loadAccessibleNeed(db, actor, needId);
  return db.searchSelection.findMany({ where: { needId, need: needScope(actor) }, orderBy: { createdAt: "desc" }, take: 200,
    select: { id: true, listingId: true, reviewStatus: true, comment: true, propertyId: true, matchId: true,
      listing: { select: { id: true, address: true, url: true, source: true, priceRub: true, areaM2: true, propertyId: true } } } });
}

const transferSchema = z.object({ confirmed: z.literal(true), identityConfirmed: z.boolean().default(false),
  address: z.string().trim().min(1).max(1000).optional(), operation: z.enum(["sale", "rent"]).optional() });
export async function transferToCatalog(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(transferSchema, input);
  await listingById(listingId);
  return transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM external_listings WHERE id = ${listingId}::uuid FOR UPDATE`));
    const listing = await tx.externalListing.findUniqueOrThrow({ where: { id: listingId } });
    if (listing.propertyId) return { id: listing.propertyId, created: false };
    const snapshot = await tx.externalListingSnapshot.findFirst({ where: { listingId }, orderBy: { fetchedAt: "desc" } });
    const facts = snapshot?.normalized as Record<string, unknown> | undefined;
    const siblingUnit = listing.sourceListingId && !listing.sourceUnitId ? await tx.externalListing.findFirst({
      where: { source: listing.source, sourceListingId: listing.sourceListingId, sourceUnitId: { not: null } }, select: { id: true },
    }) : null;
    const missingUnit = !listing.sourceUnitId && (!!siblingUnit || /#part-\d+$/u.test(listing.url));
    const unverifiedIdentity = !listing.sourceListingId || facts?.identityNeedsReview === true || missingUnit ||
      (["web_search", "manual"].includes(listing.sourceMethod) && listing.sourceListingId.startsWith("url:"));
    if (unverifiedIdentity && !data.identityConfirmed)
      throw new ConflictError("IDENTITY_CONFIRMATION_REQUIRED", "Недостаточно ключей. Проверьте первоисточник и подтвердите идентичность вручную.");
    await guardExternalUrl(listing.url);
    
    if (listing.sourceListingId) {
      await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([listing.source, listing.sourceListingId, listing.sourceUnitId])}, 0))`));
      const linked = await tx.externalListing.findFirst({ where: { source: listing.source, sourceListingId: listing.sourceListingId,
        sourceUnitId: listing.sourceUnitId, propertyId: { not: null } }, select: { propertyId: true } });
      if (linked?.propertyId) {
        await tx.externalListing.update({ where: { id: listingId }, data: { propertyId: linked.propertyId } });
        await tx.searchSelection.updateMany({ where: { listingId }, data: { propertyId: linked.propertyId } });
        await searchAudit(tx, actor, "transferred", "ExternalListing", listingId, { propertyId: linked.propertyId, reused: true, identityConfirmed: data.identityConfirmed });
        return { id: linked.propertyId, created: false };
      }
    }
    const addressText = data.address ?? listing.address;
    if (!addressText) throw new ValidationError("Укажите проверенный адрес объекта");
    
    const canCopyPrice = listing.operation === "sale" && listing.priceUnit === "total" || listing.operation === "rent" && listing.priceUnit === "per_month";
    const property = await tx.property.create({ data: { responsibleUserId: actor.userId, createdBy: actor.userId, propertyType: "commercial",
      operationType: data.operation ?? listing.operation, sourceType: "external_market", sourceUrl: listing.url,
      addressText, district: listing.district, area: listing.areaM2, floor: listing.floorNumber, price: canCopyPrice ? listing.priceRub : null,
      commercialPurpose: listing.purposes[0] ?? null, status: "active", description: listing.description } });
    await tx.externalListing.update({ where: { id: listingId }, data: { propertyId: property.id } });
    await tx.searchSelection.updateMany({ where: { listingId }, data: { propertyId: property.id } });
    await searchAudit(tx, actor, "transferred", "ExternalListing", listingId, { propertyId: property.id, identityConfirmed: data.identityConfirmed });
    return { id: property.id, created: true };
  });
}
const needAction = z.object({ needId: zUuid, comment: noteSchema });
async function actionContext(actor: Actor, listingId: string, input: unknown, client: DbOrTx = db) {
  const data = parseInput(needAction, input);
  await loadAccessibleNeed(client, actor, data.needId);
  parseInput(zUuid, listingId);
  const listing = await client.externalListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new NotFoundError();
  if (!listing.propertyId) throw new ConflictError("PROPERTY_REQUIRED", "Сначала перенесите объявление в каталог CRM и подтвердите данные объекта.");
  return { data, listing, propertyId: listing.propertyId };
}
export async function proposeListing(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(needAction, input);
  await loadAccessibleNeed(db, actor, data.needId);
  return transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`search-propose:${data.needId}`}, 0))`));
    const { propertyId } = await actionContext(actor, listingId, input, tx);
    
    const existing = await tx.needPropertyMatch.findFirst({ where: { clientNeedId: data.needId, propertyId }, orderBy: { offeredAt: "desc" } });
    const result = existing ? { created: [] as string[], skipped: [propertyId] } : await proposePropertiesInTransaction(tx, actor, data.needId, { propertyIds: [propertyId], comment: data.comment });
    const matchId = existing?.id ?? result.created[0] ?? (await tx.needPropertyMatch.findFirst({ where: { clientNeedId: data.needId, propertyId }, orderBy: { offeredAt: "desc" } }))?.id;
    await loadAccessibleNeed(tx, actor, data.needId);
    await tx.searchSelection.upsert({ where: { needId_listingId: { needId: data.needId, listingId } },
      create: { needId: data.needId, listingId, addedBy: actor.userId, propertyId, matchId, reviewStatus: "proposed", comment: data.comment },
      update: { propertyId, matchId, reviewStatus: "proposed" } });
    await searchAudit(tx, actor, "proposed", "ExternalListing", listingId, { needId: data.needId, propertyId, matchId });
    return { ...result, matchId };
  });
}
export async function listingToOffer(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(needAction, input);
  await loadAccessibleNeed(db, actor, data.needId);
  return transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`search-offer:${data.needId}`}, 0))`));
    return listingToOfferLocked(actor, listingId, input);
  });
}
async function listingToOfferLocked(actor: Actor, listingId: string, input: unknown) {
  const { data, propertyId } = await actionContext(actor, listingId, input);
  const draft = await db.commercialOffer.findFirst({ where: { clientNeedId: data.needId, status: "draft", createdBy: actor.userId }, orderBy: { createdAt: "desc" }, include: { items: { orderBy: { position: "asc" } } } });
  const offer = draft ? draft.items.some(i => i.propertyId === propertyId) ? { id: draft.id } : await updateOffer(actor, draft.id, {
    expectedUpdatedAt: draft.updatedAt.toISOString(), items: [...draft.items.map(i => ({ propertyId: i.propertyId, priceSnapshot: i.priceSnapshot?.toString(), termsSnapshot: i.termsSnapshot, comment: i.comment })), { propertyId, comment: data.comment }] }) :
    await createOffer(actor, { clientNeedId: data.needId, items: [{ propertyId, comment: data.comment }] });
  await transaction(tx => searchAudit(tx, actor, "offer", "CommercialOffer", offer.id, { listingId, needId: data.needId }));
  return offer;
}
export async function clarifyListing(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(z.object({ needId: zUuid.optional(), title: z.string().trim().min(1).max(300).default("Уточнить объявление"), dueAt: z.string().datetime() }), input);
  if (data.needId) await loadAccessibleNeed(db, actor, data.needId);
  const listing = await listingById(listingId);
  const task = await createTask(actor, { title: data.title, description: `Проверить объявление: ${listing.url}`, taskType: "call_or_contact", dueAt: data.dueAt,
    links: { needIds: data.needId ? [data.needId] : [], propertyIds: listing.propertyId ? [listing.propertyId] : [] } });
  await transaction(tx => searchAudit(tx, actor, "clarify", "Task", task.id, { listingId }));
  return task;
}
export async function verifyListing(actor: Actor, listingId: string, input: unknown) {
  const data = parseInput(z.object({ availability: z.enum(["available", "reserved", "withdrawn", "unknown"]),
    priceConfirmed: z.boolean().nullable().optional(), ownerConfirmed: z.boolean().nullable().optional(), note: noteSchema,
    nextCheckAt: z.string().datetime().nullable().optional() }), input);
  await listingById(listingId);
  return transaction(async tx => {
    const row = await tx.externalListingVerification.create({ data: { ...data, nextCheckAt: data.nextCheckAt ? new Date(data.nextCheckAt) : null, listingId, verifiedBy: actor.userId } });
    await tx.externalListing.update({ where: { id: listingId }, data: { lastCheckedAt: row.verifiedAt } });
    await searchAudit(tx, actor, "verified", "ExternalListing", listingId, { verificationId: row.id, availability: data.availability, method: "employee_check", checkedAt: row.verifiedAt.toISOString() });
    return row;
  });
}

const savedSchema = z.object({ name: z.string().trim().min(1).max(200), filters: SearchFilters, sources: z.array(z.enum(SOURCES)).max(7), needId: zUuid.nullable().optional() });
export async function saveSearch(actor: Actor, input: unknown, id?: string) {
  const data = parseInput(id ? savedSchema.extend({ expectedUpdatedAt: zExpectedUpdatedAt }) : savedSchema, input);
  if (data.needId) await loadAccessibleNeed(db, actor, data.needId);
  return transaction(async tx => {
    const values = { name: data.name, filters: jsonValue({ ...data.filters, sources: data.sources }), sources: data.sources, city: data.filters.city, needId: data.needId ?? null };
    if (id) {
      parseInput(zUuid, id);
      const existing = await tx.savedSearch.findFirst({ where: { id, ownerUserId: actor.userId } });
      if (!existing) throw new NotFoundError();
      if (existing.needId) await loadAccessibleNeed(tx, actor, existing.needId);
      const updated = await tx.savedSearch.updateMany({ where: { id, ownerUserId: actor.userId, updatedAt: parseInput(zExpectedUpdatedAt, (input as Record<string, unknown>).expectedUpdatedAt) }, data: values });
      if (!updated.count) throw new StaleUpdateError();
      await searchAudit(tx, actor, "saved_search_updated", "SavedSearch", id);
      return tx.savedSearch.findUniqueOrThrow({ where: { id } });
    }
    const saved = await tx.savedSearch.create({ data: { ...values, ownerUserId: actor.userId } });
    await searchAudit(tx, actor, "saved_search_created", "SavedSearch", saved.id);
    return saved;
  });
}
export async function listSavedSearches(actor: Actor) {
  return db.savedSearch.findMany({ where: { ownerUserId: actor.userId, OR: [{ needId: null }, { need: needScope(actor) }] }, orderBy: { updatedAt: "desc" }, take: 200 });
}
export async function deleteSavedSearch(actor: Actor, id: string) {
  parseInput(zUuid, id);
  return transaction(async tx => {
    const saved = await tx.savedSearch.findFirst({ where: { id, ownerUserId: actor.userId } });
    if (!saved) throw new NotFoundError();
    if (saved.needId) await loadAccessibleNeed(tx, actor, saved.needId);
    await tx.savedSearch.update({ where: { id }, data: { lastSuccessfulRunId: null } });
    await tx.searchRun.updateMany({ where: { savedSearchId: id }, data: { savedSearchId: null } });
    await tx.savedSearch.delete({ where: { id } });
    await searchAudit(tx, actor, "saved_search_removed", "SavedSearch", id);
    return { ok: true };
  });
}
export async function prefillSearch(actor: Actor, needId?: string) {
  if (!needId) return SearchFilters.parse({ operation: "sale" });
  const need = await loadAccessibleNeed(db, actor, needId);
  const operation = ["rent", "rent_in"].includes(need.operationType) ? "rent" : "sale";
  return SearchFilters.parse({ city: "Новосибирск", operation, priceUnit: operation === "rent" ? "rub_month" : "rub_total",
    priceFrom: need.budgetMin?.toString(), priceTo: need.budgetMax?.toString(), areaFrom: need.areaMin ? Number(need.areaMin) : undefined,
    areaTo: need.areaMax ? Number(need.areaMax) : undefined, districts: need.district ? [need.district] : [],
    purposes: PURPOSES.includes(need.commercialPurpose as typeof PURPOSES[number]) ? [need.commercialPurpose] : [],
    floorMode: need.floorMin === 1 && need.floorMax === 1 ? "first_floor_only" : need.floorMin !== null && need.floorMin >= 1 ? "exclude_basement_and_semi_basement" : "any" });
}
