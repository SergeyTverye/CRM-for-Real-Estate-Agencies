import { beforeEach, describe, expect, it } from "vitest";
import { CODEBOOK_COLUMNS, codesOf, checkConstraintName } from "@/shared/codebook";
import { db, makeClient, makeNeed, makeProperty, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";

let users: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  users = await seedBase();
});

const listingData = {
  source: "cian", sourceListingId: "listing-123", url: "https://example.test/listing-123",
  sourceMethod: "scraper", operation: "rent", priceUnit: "per_month", priceRub: "150000.25",
};

describe("v2.4.1 schema and migrations on PostgreSQL", () => {
  it("all current codebook constraints exist in the database with exactly the current codes", async () => {
    const sqlite = process.env.CRM_DEPLOYMENT_MODE === "desktop";
    const constraints = sqlite ? (await db.$queryRawUnsafe<{sql:string}[]>("SELECT sql FROM sqlite_master WHERE type='table'")).flatMap(row => Array.from(row.sql.matchAll(/CONSTRAINT "([^"]+)" CHECK \(([^\n]+)\)/g), match => ({name:match[1]!,definition:match[2]!}))) : await db.$queryRaw<{ name: string; definition: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    for (const entry of CODEBOOK_COLUMNS) {
      const actual = constraints.find((c) => c.name === checkConstraintName(entry.table, entry.column));
      expect(actual, `${entry.table}.${entry.column}`).toBeDefined();
      const codes = Array.from(actual!.definition.matchAll(sqlite ? /'([^']*)'/g : /'([^']*)'::text/g), (m) => m[1]);
      expect(codes.sort()).toEqual([...codesOf(entry.book)].sort());
    }
  });

  it("deduplicates a known source ID with a null unit, preserves distinct units and unknown identities", async () => {
    await db.externalListing.create({ data: listingData });
    await expect(db.externalListing.create({ data: listingData })).rejects.toThrow();
    await db.externalListing.create({ data: { ...listingData, sourceUnitId: "unit-A" } });
    await db.externalListing.create({ data: { ...listingData, sourceUnitId: "unit-B" } });
    await db.externalListing.create({ data: { ...listingData, sourceListingId: null } });
    await db.externalListing.create({ data: { ...listingData, sourceListingId: null } });
    expect(await db.externalListing.count()).toBe(5);
  });

  it("persists selections without creating a property or match; restricts deletion of their history", async () => {
    const client = await makeClient(users.realtor1);
    const need = await makeNeed(users.realtor1, client.id);
    const listing = await db.externalListing.create({ data: listingData });
    const selection = await db.searchSelection.create({ data: {
      needId: need.id, listingId: listing.id, addedBy: users.realtor1.userId,
    } });
    expect(selection.propertyId).toBeNull();
    expect(selection.matchId).toBeNull();
    expect(await db.property.count()).toBe(0);
    await expect(db.externalListing.delete({ where: { id: listing.id } })).rejects.toThrow();
    await expect(db.searchSelection.create({ data: {
      needId: need.id, listingId: listing.id, addedBy: users.realtor1.userId,
    } })).rejects.toThrow();
  });

  it("allows one active cover, clears an archived cover, rejects archived documents as covers", async () => {
    const property = await makeProperty(users.realtor1);
    const createPhoto = (key: string) => db.document.create({ data: {
      originalName: `${key}.jpg`, documentTypeCode: "photo", mimeType: "image/jpeg", fileSize: 12,
      storageKey: key, uploadedBy: users.realtor1.userId,
      propertyLinks: { create: { propertyId: property.id, kind: "photo" } },
    } });
    const one = await createPhoto("cover-one");
    const two = await createPhoto("cover-two");
    const where = (documentId: string) => ({ documentId_propertyId: { documentId, propertyId: property.id } });
    await db.documentProperty.update({ where: where(one.id), data: { isCover: true } });
    await expect(db.documentProperty.update({ where: where(two.id), data: { isCover: true } })).rejects.toThrow();
    await db.document.update({ where: { id: one.id }, data: { archivedAt: new Date() } });
    expect((await db.documentProperty.findUniqueOrThrow({ where: where(one.id) })).isCover).toBe(false);
    await db.documentProperty.update({ where: where(two.id), data: { isCover: true } });
    await expect(db.documentProperty.update({ where: where(one.id), data: { isCover: true } })).rejects.toThrow();
  });

  it("enforces singleton AI settings, exact budget decimals, positive event intervals and notification deduplication", async () => {
    await db.aiSetting.create({ data: {} });
    await expect(db.aiSetting.create({ data: {} })).rejects.toThrow();
    const usage = await db.aiUsageLog.create({ data: {
      callType: "parse", userId: users.realtor1.userId, model: "synthetic", estimatedCostRub: "0.25",
    } });
    const reservation = await db.aiBudgetReservation.create({ data: { usageLogId: usage.id, amountRub: "0.25" } });
    expect(reservation.amountRub.toFixed(2)).toBe("0.25");
    await expect(db.aiBudgetReservation.create({ data: { amountRub: "-0.01" } })).rejects.toThrow();
    const now = new Date();
    await expect(db.calendarEvent.create({ data: {
      ownerUserId: users.realtor1.userId, startAt: now, endAt: now, title: "Synthetic interval",
    } })).rejects.toThrow();
    const data = { recipientUserId: users.realtor1.userId, kind: "task", sourceType: "task",
      sourceId: reservation.id, triggerAt: now, title: "Synthetic notification", link: "/tasks", dedupKey: "synthetic:1" };
    await db.notification.create({ data });
    await expect(db.notification.create({ data })).rejects.toThrow();
  });
});
