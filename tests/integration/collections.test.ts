import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty } from "../helpers/fixtures";
import { createCollection, addItems, getCollection, updateCollection, linkNeed, collectionToOffer, updateItem, collectionItemAction } from "@/modules/collections/application/collection-service";
import { exportCollection } from "@/modules/collections/application/export-service";

describe("AT-10 именованная подборка", () => {
  beforeEach(resetDatabase);
  it("без клиента → смешанный состав → порядок → потребность → экспорт → КП со снимком, без лишних Property/Match", async () => {
    const { realtor1: actor } = await seedBase();
    const p = await makeProperty(actor, { addressText: "=1+1", price: "100000" });
    const listing = await db.externalListing.create({ data: { source: "cian", sourceMethod: "scraper", priceUnit: "total", sourceListingId: "collection-test", url: "https://www.cian.ru/sale/commercial/123/", operation: "sale", address: "Внешний объект", purposes: ["office"] } });
    const collection = await createCollection(actor, { name: "Офисы без клиента", visibility: "team" });
    expect(await addItems(actor, collection.id, [{ externalListingId: listing.id }, { propertyId: p.id }])).toEqual({ added: 2 });
    expect(await addItems(actor, collection.id, [{ externalListingId: listing.id }])).toEqual({ added: 0 });
    expect(await db.property.count()).toBe(1); expect(await db.needPropertyMatch.count()).toBe(0);
    let card = await getCollection(actor, collection.id); expect(card.needs).toHaveLength(0);
    const reversed = card.items.map(i => i.id).reverse();
    await updateCollection(actor, card.id, { expectedUpdatedAt: card.updatedAt.toISOString(), itemIds: reversed });
    card = await getCollection(actor, card.id); expect(card.items.map(i => i.id)).toEqual(reversed);
    const client = await makeClient(actor); const need = await makeNeed(actor, client.id);
    await linkNeed(actor, card.id, { expectedUpdatedAt: card.updatedAt.toISOString(), needId: need.id });
    const csv = await exportCollection(actor, card.id, { format: "csv" }); expect(new TextDecoder().decode(csv.bytes)).toContain("'=1+1");
    const xlsx = await exportCollection(actor, card.id, { format: "xlsx" }); const book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.bytes.buffer as ArrayBuffer); expect(book.worksheets[0]!.rowCount).toBe(3);
    await expect(collectionToOffer(actor, card.id, { needId: need.id, itemIds: reversed })).rejects.toMatchObject({ code: "PROPERTY_REQUIRED" });
    const crmItem = card.items.find(i => i.propertyId)!;
    const offer = await collectionToOffer(actor, card.id, { needId: need.id, itemIds: [crmItem.id] });
    await db.property.update({ where: { id: p.id }, data: { addressText: "Новый адрес" } });
    const snapshot = await db.commercialOfferItem.findFirstOrThrow({ where: { commercialOfferId: offer.id } }); expect(snapshot.addressSnapshot).toBe("=1+1");
    expect(await db.property.count()).toBe(1); expect(await db.needPropertyMatch.count()).toBe(0); expect((await db.commercialOffer.findUniqueOrThrow({ where: { id: offer.id } })).sentAt).toBeNull();
    card = await getCollection(actor, card.id);
    await linkNeed(actor, card.id, { expectedUpdatedAt: card.updatedAt.toISOString(), needId: need.id, unlink: true });
    expect((await getCollection(actor, card.id)).needs).toHaveLength(0);
  });
  it("XOR, stale reorder, reason and derived status cannot be bypassed", async () => {
    const { realtor1: actor } = await seedBase(); const p = await makeProperty(actor); const c = await createCollection(actor, { name: "Проверки" });
    await expect(addItems(actor, c.id, [{}])).rejects.toThrow();
    await addItems(actor, c.id, [{ propertyId: p.id }]); const card = await getCollection(actor, c.id); const item = card.items[0]!;
    await expect(updateItem(actor, c.id, item.id, { expectedUpdatedAt: item.updatedAt.toISOString(), status: "proposed" })).rejects.toThrow();
    await expect(updateItem(actor, c.id, item.id, { expectedUpdatedAt: item.updatedAt.toISOString(), status: "excluded" })).rejects.toThrow();
    await updateItem(actor, c.id, item.id, { expectedUpdatedAt: item.updatedAt.toISOString(), status: "excluded", exclusionReason: "Не подходит" });
    await expect(updateCollection(actor, c.id, { expectedUpdatedAt: card.updatedAt.toISOString(), itemIds: [item.id] })).rejects.toMatchObject({ code: "STALE_UPDATE" });
  });
  it("несколько потребностей, проверка и явное предложение внешнего объекта через существующий сервис", async () => {
    const { realtor1: actor } = await seedBase(); const p = await makeProperty(actor);
    const client = await makeClient(actor); const first = await makeNeed(actor, client.id); const second = await makeNeed(actor, client.id);
    const listing = await db.externalListing.create({ data: { source: "cian", sourceMethod: "scraper", priceUnit: "total", sourceListingId: "verified-collection", url: "https://www.cian.ru/sale/commercial/123/", operation: "sale", propertyId: p.id } });
    const c = await createCollection(actor, { name: "Повторное предложение" }); await addItems(actor, c.id, [{ externalListingId: listing.id }]);
    let card = await getCollection(actor, c.id); const item = card.items[0]!;
    await expect(collectionItemAction(actor, c.id, item.id, { action: "transfer", confirmed: false })).rejects.toThrow();
    await collectionItemAction(actor, c.id, item.id, { action: "transfer", confirmed: true });
    for (const need of [first, second]) { card = await getCollection(actor, c.id); await linkNeed(actor, c.id, { needId: need.id, expectedUpdatedAt: card.updatedAt.toISOString() }); }
    expect((await getCollection(actor, c.id)).needs).toHaveLength(2);
    await collectionItemAction(actor, c.id, item.id, { action: "verify", availability: "available" });
    expect((await getCollection(actor, c.id)).items[0]!.externalListing!.verifications[0]!.availability).toBe("available");
    await collectionItemAction(actor, c.id, item.id, { action: "propose", needId: first.id });
    await collectionItemAction(actor, c.id, item.id, { action: "propose", needId: first.id });
    expect((await getCollection(actor, c.id)).items[0]!.status).toBe("proposed");
    expect(await db.needPropertyMatch.count()).toBe(1); expect(await db.property.count()).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "PropertyCollection", entityId: c.id } })).toBeGreaterThan(5);
  });
});
