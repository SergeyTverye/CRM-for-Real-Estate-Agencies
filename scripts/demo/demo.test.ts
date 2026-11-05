import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db, demoId, marker } from "./context";
import type { Actor } from "@/modules/auth/domain/actor";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { openPropertyMedia } from "@/modules/properties/application/property-media-service";
import { getContactControl } from "@/modules/requests/application/contact-control";

const manager = async (): Promise<Actor> => {
  const u = await db.user.findUniqueOrThrow({ where: { login: "manager" } });
  return { userId: u.id, login: u.login, displayName: u.displayName, role: "manager", mustChangePassword: u.mustChangePassword, sessionId: demoId("verification") };
};
afterAll(() => db.$disconnect());

describe("crm_demo synthetic demonstration acceptance (no reset)", () => {
  it("uses synthetic contacts and both realtors; preserves active and paused need invariants", async () => {
    const clients = await db.client.findMany({ where: { notes: { contains: marker } }, include: { contacts: true, needs: true, responsible: true } });
    expect(clients).toHaveLength(25);
    expect(new Set(clients.map(c => c.responsible.login))).toEqual(new Set(["realtor1", "realtor2"]));
    for (const client of clients) for (const contact of client.contacts) {
      if (contact.contactType === "phone") expect(contact.rawValue).toMatch(/^\+7 900 000-\d{2}-\d{2}$/);
      if (contact.contactType === "email") expect(contact.rawValue).toMatch(/@example\.ru$/);
    }
    const needs = clients.flatMap(c => c.needs);
    await assertNeedInvariants(db, needs.map(n => n.id));
    expect(needs.some(n => n.status === "paused")).toBe(true);
    expect(needs.filter(n => n.status === "success").every(n => n.notes && n.closedAt)).toBe(true);
  });
  it("provides 3–6 captioned photos, a single cover, and actual downloadable files", async () => {
    const properties = await db.property.findMany({ where: { description: { contains: "Синтетическая демонстрационная карточка" } }, include: { documentLinks: { include: { document: true } } } });
    expect(properties).toHaveLength(30);
    const actor = await manager();
    for (const property of properties) {
      const photos = property.documentLinks.filter(l => l.kind === "photo" && !l.archivedAt);
      expect(photos.length).toBeGreaterThanOrEqual(3);
      expect(photos.length).toBeLessThanOrEqual(6);
      expect(photos.filter(l => l.isCover)).toHaveLength(1);
      expect(photos.every(l => l.caption?.includes(marker) && l.document.thumbnailStorageKey)).toBe(true);
    }
    const linked = properties.flatMap(p => p.documentLinks.filter(l => l.kind === "document").map(l => ({ ...l, propertyId: p.id })));
    expect(linked).toHaveLength(8);
    const photo = properties[0]!.documentLinks.find(l => l.kind === "photo")!;
    for (const link of [...linked, { ...photo, propertyId: properties[0]!.id }]) {
      const opened = await openPropertyMedia(actor, link.propertyId, link.documentId);
      const chunks: Buffer[] = [];
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks);
      expect(data.length).toBe(Number(link.document.fileSize));
      expect(createHash("sha256").update(data).digest("hex")).toBe(link.document.checksum);
    }
  });
  it("keeps offer revisions identical to their historical snapshot after a current price change", async () => {
    const sources = await db.commercialOffer.findMany({ where: { notes: marker, promptTemplateVersion: null }, include: { items: true } });
    expect(sources).toHaveLength(2);
    expect(sources.map(o => o.status).sort()).toEqual(["draft", "sent"]);
    const source = sources.find(o => o.status === "sent")!;
    expect(source.sentAt).not.toBeNull();
    const revisions = await db.commercialOffer.findMany({ where: { promptTemplateVersion: `revision-of:${source.id}` }, include: { items: true } });
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    const snapshots = (items: typeof source.items) => items.map(i => [i.propertyId, i.priceSnapshot?.toString(), i.addressSnapshot, i.areaSnapshot?.toString(), i.termsSnapshot]).sort();
    for (const revision of revisions) expect(snapshots(revision.items)).toEqual(snapshots(source.items));
    const item = source.items[0]!;
    const rollback = new Error("rollback synthetic price check");
    await expect(db.$transaction(async tx => {
      await tx.property.update({ where: { id: item.propertyId }, data: { price: "99999999" } });
      const stored = await tx.commercialOfferItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(stored.priceSnapshot?.toString()).toBe(item.priceSnapshot?.toString());
      throw rollback;
    })).rejects.toBe(rollback);
  });
  it("includes rent/sale, open/completed deals, commissions, checklist files, and postdeal links", async () => {
    const deals = await db.deal.findMany({
      where: { notes: { startsWith: marker } },
      include: {
        property: true, parties: true, commissions: true, checklistItems: true, agreements: true,
        taskLinks: { include: { task: { include: { clientLinks: true, propertyLinks: true } } } },
      },
    });
    expect(deals).toHaveLength(4);
    expect(new Set(deals.map(d => `${d.status}:${d.property.operationType}`))).toEqual(new Set(["documents:sale", "documents:rent", "completed:sale", "completed:rent"]));
    for (const deal of deals) {
      expect(deal.parties).toHaveLength(2);
      expect(deal.commissions).toHaveLength(2);
      expect(new Set(deal.checklistItems.map(c => c.status))).toEqual(new Set(["none", "review", "verified", "not_required"]));
      expect(deal.checklistItems.some(c => c.documentId)).toBe(true);
      expect(deal.agreements.some(a => a.signedAt && a.validUntil)).toBe(true);
      if (deal.status === "completed") {
        expect(deal.closedAt).not.toBeNull();
        expect(deal.taskLinks).toHaveLength(4);
        expect(deal.taskLinks.every(l => l.task.taskType === "postdeal" && l.task.clientLinks.length && l.task.propertyLinks.length)).toBe(true);
      }
    }
  });
  it("records success, partial refusal, full refusal with labelled demo web fallback, and selection transfer", async () => {
    const runs = await db.searchRun.findMany({ where: { fallbackReason: { startsWith: `${marker} DEMO recorded` } }, include: { sources: true, results: { include: { listing: true } } } });
    expect(runs).toHaveLength(3);
    expect(runs.some(r => r.status === "success" && r.sources.every(s => s.status === "success"))).toBe(true);
    expect(runs.some(r => r.sources.some(s => s.status === "blocked") && r.sources.some(s => s.source !== "web_search" && s.status === "success"))).toBe(true);
    const fallback = runs.find(r => r.webSearchUsed)!;
    expect(fallback.sources.filter(s => s.source !== "web_search").every(s => s.status === "blocked")).toBe(true);
    expect(fallback.results.some(r => r.listing.sourceMethod === "web_search" && r.verdict === "needs_review")).toBe(true);
    expect(runs.every(r => r.sources.every(s => s.reason?.includes(marker)))).toBe(true);
    expect(await db.savedSearch.count({ where: { name: { startsWith: marker } } })).toBe(2);
    expect(await db.searchBookmark.count()).toBeGreaterThanOrEqual(2);
    const selected = await db.searchSelection.findMany({ include: { property: true, match: true, creator: true } });
    expect(selected.some(s => s.matchId && s.property?.sourceType === "external_market" && s.match?.propertyId === s.propertyId)).toBe(true);
    expect(selected.every(s => s.creator.login === "realtor1")).toBe(true);
    const transferred = selected.find(s => s.matchId)!.property!;
    const media = await db.documentProperty.findMany({ where: { propertyId: transferred.id, kind: "photo", archivedAt: null } });
    expect(media.length).toBeGreaterThanOrEqual(3);
    expect(media.length).toBeLessThanOrEqual(6);
    expect(media.filter(m => m.isCover)).toHaveLength(1);
  });
  it("shows read/unread worker notifications, synthetic AI usage and /today exceptions", async () => {
    for (const login of ["realtor1", "realtor2"]) {
      const u = await db.user.findUniqueOrThrow({ where: { login } });
      expect(await db.notification.count({ where: { recipientUserId: u.id, state: "read", readAt: { not: null } } })).toBeGreaterThan(0);
      expect(await db.notification.count({ where: { recipientUserId: u.id, state: "delivered", readAt: null } })).toBeGreaterThan(0);
    }
    const usage = await db.aiUsageLog.findMany({ where: { id: { in: Array.from({ length: 6 }, (_, i) => demoId(`usage:${i}`)) } } });
    expect(usage).toHaveLength(6);
    expect(new Set(usage.map(u => u.callType))).toEqual(new Set(["parse", "description", "web_search"]));
    expect(usage.every(u => u.actualCostRub && u.estimatedCostRub.gte(u.actualCostRub) && JSON.stringify(u.result).includes('"demo":true'))).toBe(true);
    const queues = await getContactControl(await manager());
    expect(queues.requests.length).toBeGreaterThanOrEqual(2);
    expect(queues.overdue.length).toBeGreaterThan(0);
  });
});
