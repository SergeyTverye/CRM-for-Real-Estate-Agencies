import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase } from "../helpers/fixtures";
import { regroupForListings, getDuplicateGroup, getGroupsForListings, decideDuplicateGroup } from "@/modules/listing-duplicates/application/duplicate-service";
import { explainDuplicateGroup } from "@/modules/listing-duplicates/application/explanation-service";
async function listings(count = 2) {
  const result = [];
  for (let i = 0; i < count; i++) result.push(await db.externalListing.create({ data: { source: ["cian", "yandex", "onrealt"][i]!, sourceListingId: `duplicate-test-${i}`, url: `https://www.cian.ru/sale/commercial/${i + 100}/`, sourceMethod: "scraper", operation: "sale", city: "Новосибирск", address: "Мира 58", areaM2: "100", floorNumber: 1, purposes: ["office"], priceUnit: "total", priceRub: "10000000" } }));
  return result;
}
describe("SR-07 grouping and durable human decisions", () => {
  beforeEach(resetDatabase);
  it("повторный запуск, конкурентная группировка, независимые источники и история цен", async () => {
    const { realtor1: actor } = await seedBase(); const rows = await listings();
    await db.externalListingSnapshot.create({ data: { listingId: rows[0]!.id, priceRub: "9000000", normalized: { priceUnit: "rub_total", sellerName: "Скрыто" } } });
    const ids = rows.map(r => r.id);
    const [a, b] = await Promise.all([regroupForListings(ids), regroupForListings(ids)]);
    expect(a.groupIds).toEqual(b.groupIds); expect(await db.listingDuplicateGroup.count()).toBe(1);
    const groups = await getGroupsForListings(actor, [ids[0]!]); expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2); expect(groups[0]!.members.find(m => m.listingId === ids[0])!.listing.priceHistory[0]).toMatchObject({ price: "9000000", priceUnit: "rub_total" });
    expect(JSON.stringify(groups)).not.toContain("Скрыто"); expect(await db.property.count()).toBe(0);
  });
  it("не объединяет разные этажи и помещения в реальной БД", async () => {
    const { realtor1: actor } = await seedBase(); const rows = await listings(); const ids = rows.map(r => r.id);
    await db.externalListing.update({ where: { id: ids[1]! }, data: { floorNumber: 2 } });
    expect(await regroupForListings(ids)).toEqual({ groupIds: [] });
    await db.externalListing.update({ where: { id: ids[0]! }, data: { address: "Мира 58 пом 1" } });
    await db.externalListing.update({ where: { id: ids[1]! }, data: { floorNumber: 1, address: "Мира 58 пом 2" } });
    expect(await regroupForListings(ids)).toEqual({ groupIds: [] });
    expect(await getGroupsForListings(actor, ids)).toHaveLength(0);
  });
  it("different подавляет группу при следующем запуске, решение и аудит сохранены", async () => {
    const { realtor1: actor } = await seedBase(); const ids = (await listings()).map(r => r.id);
    const { groupIds } = await regroupForListings(ids); let group = await getDuplicateGroup(actor, groupIds[0]!);
    group = await decideDuplicateGroup(actor, group.id, { decision: "different", confirmed: true, expectedUpdatedAt: group.updatedAt });
    expect(group.status).toBe("rejected"); expect(group.members.every(m => m.releasedAt)).toBe(true);
    expect(await regroupForListings(ids)).toEqual({ groupIds: [] }); expect(await db.listingDuplicateGroup.count()).toBe(1);
    expect(group.decisions[0]!.decider.displayName).toBe(actor.displayName);
    expect(await db.auditLog.count({ where: { entityType: "ListingDuplicateGroup", action: "duplicate_different" } })).toBe(1);
  });
  it("split не возвращает исключённое объявление, confirm/defer не меняются после regroup", async () => {
    const { realtor1: actor } = await seedBase(); const rows = await listings(3); const ids = rows.map(r => r.id);
    const { groupIds } = await regroupForListings(ids); let group = await getDuplicateGroup(actor, groupIds[0]!);
    const split = ids[2]!;
    group = await decideDuplicateGroup(actor, group.id, { decision: "split", listingId: split, confirmed: true, expectedUpdatedAt: group.updatedAt });
    const oldVersion = group.updatedAt;
    group = await decideDuplicateGroup(actor, group.id, { decision: "defer", confirmed: true, expectedUpdatedAt: group.updatedAt });
    await expect(decideDuplicateGroup(actor, group.id, { decision: "confirm", confirmed: true, expectedUpdatedAt: oldVersion })).rejects.toMatchObject({ code: "STALE_UPDATE" });
    await regroupForListings(ids); expect((await getDuplicateGroup(actor, group.id)).status).toBe("deferred");
    group = await decideDuplicateGroup(actor, group.id, { decision: "confirm", confirmed: true, expectedUpdatedAt: group.updatedAt });
    await regroupForListings(ids); const actual = await getDuplicateGroup(actor, group.id);
    expect(actual.status).toBe("confirmed"); expect(actual.updatedAt).toBe(group.updatedAt);
    expect(actual.members.find(m => m.listingId === split)!.releasedAt).not.toBeNull();
    expect(await db.listingDuplicateGroup.count()).toBe(1); expect(await db.externalListing.count()).toBe(3);
  });
  it("новое объявление не обходит отрицательное решение через транзитивную связь", async () => {
    const { realtor1: actor } = await seedBase(); const rows = await listings(); const ids = rows.map(r => r.id);
    const { groupIds } = await regroupForListings(ids); const group = await getDuplicateGroup(actor, groupIds[0]!);
    await decideDuplicateGroup(actor, group.id, { decision: "different", confirmed: true, expectedUpdatedAt: group.updatedAt });
    const third = await db.externalListing.create({ data: { source: "avito", sourceListingId: "third", url: "https://www.avito.ru/123", sourceMethod: "scraper", operation: "sale", city: "Новосибирск", address: "Мира 58", areaM2: "100", floorNumber: 1, purposes: ["office"], priceUnit: "total" } });
    await regroupForListings([...ids, third.id]);
    const groups = await getGroupsForListings(actor, [...ids, third.id]);
    for (const g of groups) expect(g.members.filter(m => !m.releasedAt).map(m => m.listingId)).not.toEqual(expect.arrayContaining(ids));
  });
  it("ИИ только preview, ручное подтверждение и версия обязательны, провайдер получает только признаки", async () => {
    const { realtor1: actor } = await seedBase(); const ids = (await listings()).map(r => r.id);
    const { groupIds } = await regroupForListings(ids); const group = await getDuplicateGroup(actor, groupIds[0]!);
    const analyzeDescriptions = vi.fn().mockResolvedValue({ evidence: [], mode: "test" });
    await expect(explainDuplicateGroup(actor, group.id, { confirmedPaid: false, expectedUpdatedAt: group.updatedAt }, { analyzeDescriptions })).rejects.toThrow();
    const result = await explainDuplicateGroup(actor, group.id, { confirmedPaid: true, expectedUpdatedAt: group.updatedAt }, { analyzeDescriptions });
    expect(result.humanConfirmationRequired).toBe(true); expect(analyzeDescriptions).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(analyzeDescriptions.mock.calls[0]![1]);
    expect(payload).not.toContain("https:"); expect(payload).not.toContain("Мира"); expect(payload).not.toContain("seller");
    expect((await getDuplicateGroup(actor, group.id)).status).toBe("probable"); expect(await db.listingDuplicateDecision.count()).toBe(0);
  });
});
