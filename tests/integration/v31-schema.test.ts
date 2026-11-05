import { beforeEach, describe, expect, it } from "vitest";
import { db, makeClient, makeNeed, makeProperty, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
const listingData = { source: "cian", url: "https://example.test/listing", sourceMethod: "scraper", operation: "sale", priceUnit: "total" };

describe("v3.1 additive PostgreSQL invariants", () => {
  it("keeps historical publication unknown and stores explicit price units and immutable snapshot values", async () => {
    const listing = await db.externalListing.create({ data: listingData });
    expect(listing.publishedAt).toBeNull();
    expect(listing.dateSource).toBe("unknown");
    const snapshot = await db.externalListingSnapshot.create({ data: {
      listingId: listing.id, normalized: {}, publishedAt: new Date("2026-11-01T01:00:00Z"),
      dateSource: "site_published", datePrecision: "exact", pricePerM2Rub: "12345.67", pricePerM2Unit: "per_m2",
    } });
    await db.externalListing.update({ where: { id: listing.id }, data: { pricePerM2Rub: "15000", pricePerM2Unit: "per_m2" } });
    expect((await db.externalListingSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).pricePerM2Rub?.toFixed(2)).toBe("12345.67");
  });

  it("deduplicates queue launches, persists restart state, and isolates browser metadata", async () => {
    const data = { userId: users.realtor1.userId, filters: {}, status: "queued", idempotencyKey: "synthetic-run", depthParams: { cian: { maxPages: 3, limit: 60 } } };
    const run = await db.searchRun.create({ data });
    await expect(db.searchRun.create({ data })).rejects.toThrow();
    await db.searchRun.update({ where: { id: run.id }, data: { status: "needs_user_action", lockedBy: "worker-1", heartbeatAt: new Date(), cancelRequested: true, progress: { cian: 1 } } });
    await db.searchRunSource.create({ data: { runId: run.id, source: "cian", status: "needs_user_action", requestedCount: 60, receivedCount: 12, acceptedCount: 3, depthReached: 1, needsUserAction: true } });
    const browser = { searchRunId: run.id, source: "cian", ownerUserId: users.realtor1.userId, expiresAt: new Date(Date.now() + 60_000) };
    await db.interactiveBrowserSession.create({ data: { ...browser, startUrlHost: "example.test" } });
    await expect(db.interactiveBrowserSession.create({ data: { ...browser, startUrlHost: "https://example.test/?token=secret" } })).rejects.toThrow();
    await expect(db.searchRun.delete({ where: { id: run.id } })).rejects.toThrow();
  });

  it("enforces one active duplicate group and retains decisions and released membership", async () => {
    const listing = await db.externalListing.create({ data: listingData });
    const one = await db.listingDuplicateGroup.create({ data: { members: { create: { listingId: listing.id } } } });
    const two = await db.listingDuplicateGroup.create({ data: {} });
    await expect(db.listingDuplicateMember.create({ data: { groupId: two.id, listingId: listing.id } })).rejects.toThrow();
    await db.listingDuplicateDecision.create({ data: { groupId: one.id, decision: "different", decidedBy: users.manager.userId } });
    await db.listingDuplicateGroup.update({ where: { id: one.id }, data: { status: "rejected" } });
    await db.listingDuplicateMember.create({ data: { groupId: two.id, listingId: listing.id } });
    expect(await db.listingDuplicateMember.count({ where: { listingId: listing.id } })).toBe(2);
    expect(await db.listingDuplicateDecision.count({ where: { groupId: one.id } })).toBe(1);
    await expect(db.listingDuplicateGroup.delete({ where: { id: one.id } })).rejects.toThrow();
  });

  it("supports mixed independent collections, XOR targets and many linked needs", async () => {
    const listing = await db.externalListing.create({ data: listingData });
    const property = await makeProperty(users.realtor1);
    const collection = await db.propertyCollection.create({ data: { name: "Синтетическая подборка", ownerUserId: users.realtor1.userId } });
    const base = { collectionId: collection.id, addedBy: users.realtor1.userId };
    await expect(db.propertyCollectionItem.create({ data: base })).rejects.toThrow();
    await expect(db.propertyCollectionItem.create({ data: { ...base, propertyId: property.id, externalListingId: listing.id } })).rejects.toThrow();
    await db.propertyCollectionItem.create({ data: { ...base, externalListingId: listing.id } });
    await db.propertyCollectionItem.create({ data: { ...base, propertyId: property.id, sortOrder: 1 } });
    const client = await makeClient(users.realtor1);
    for (let i = 0; i < 2; i++) {
      const need = await makeNeed(users.realtor1, client.id);
      await db.propertyCollectionNeed.create({ data: { collectionId: collection.id, needId: need.id, linkedBy: users.realtor1.userId } });
    }
    expect(await db.needPropertyMatch.count()).toBe(0);
    expect(await db.propertyCollectionNeed.count()).toBe(2);
  });

  it("reuses task recurrence, independent checklist, singleton planner and bulk idempotency", async () => {
    const batchData = { idempotencyKey: "synthetic-batch", createdBy: users.manager.userId, count: 1, template: { title: "Контроль" } };
    const batch = await db.bulkTaskBatch.create({ data: batchData });
    await expect(db.bulkTaskBatch.create({ data: batchData })).rejects.toThrow();
    await db.plannerSetting.create({ data: { updatedBy: users.manager.userId } });
    await expect(db.plannerSetting.create({ data: {} })).rejects.toThrow();
    const task = await db.task.create({ data: { title: "Контроль", responsibleUserId: users.realtor1.userId, createdBy: users.manager.userId, taskType: "other", status: "planned", priority: "critical", dueAt: new Date(), recurrenceKind: "monthly", recurrenceInterval: 3, recurrenceRule: "FREQ=MONTHLY;INTERVAL=3;COUNT=4", reminderOffsets: [60, 0], bulkBatchId: batch.id } });
    const item = await db.taskChecklistItem.create({ data: { taskId: task.id, title: "Проверить", required: true, responsibleUserId: users.realtor1.userId } });
    expect(task.parentTaskId).toBeNull();
    await db.taskChecklistItem.update({ where: { id: item.id }, data: { status: "done", completedAt: new Date(), completedBy: users.realtor1.userId, result: "Проверено" } });
    await expect(db.task.delete({ where: { id: task.id } })).rejects.toThrow();
  });

  it("retains nonprospective calls without a client", async () => {
    for (const outcomeCode of ["spam", "wrong", "one_time", "prospective"]) {
      const call = await db.leadRequest.create({ data: { outcomeCode, occurredAt: new Date(), callAt: new Date(), responsibleUserId: users.realtor1.userId, createdBy: users.realtor1.userId, channelCode: "phone", sourceCode: "website", resultCode: "no_followup", statusCode: "closed" } });
      expect(call.clientId).toBeNull();
    }
    expect(await db.leadRequest.count()).toBe(4);
  });

  it("restricts template current version to its owner and preserves generated document provenance", async () => {
    const a = await db.documentTemplate.create({ data: { code: "synthetic-a", name: "Шаблон", format: "markdown_docx", allowedSources: ["client"] } });
    const b = await db.documentTemplate.create({ data: { code: "synthetic-b", name: "Другой шаблон", format: "docx", allowedSources: [] } });
    const version = await db.documentTemplateVersion.create({ data: { templateId: a.id, version: 1, manifestYaml: "fields: []", markdownBody: "Тест", checksum: "synthetic", createdBy: users.manager.userId } });
    await expect(db.documentTemplate.update({ where: { id: b.id }, data: { currentVersionId: version.id } })).rejects.toThrow();
    await db.documentTemplate.update({ where: { id: a.id }, data: { currentVersionId: version.id } });
    await db.document.create({ data: { originalName: "test.docx", documentTypeCode: "other", mimeType: "application/octet-stream", fileSize: 10, storageKey: "synthetic-doc", uploadedBy: users.manager.userId, templateVersionId: version.id, valuesSnapshot: { client: { displayName: "Тест" } } } });
    await expect(db.documentTemplateVersion.delete({ where: { id: version.id } })).rejects.toThrow();
  });

  it("isolates pending actions by chat, links cache usage and journals export parameters", async () => {
    const data = { title: "Синтетический чат", ownerUserId: users.realtor1.userId };
    const session = await db.aiChatSession.create({ data });
    const other = await db.aiChatSession.create({ data });
    const action = await db.aiPendingAction.create({ data: { sessionId: session.id, actionType: "create_task", payload: { title: "Черновик" } } });
    await expect(db.aiChatMessage.create({ data: { sessionId: other.id, role: "assistant", content: "Предпросмотр", pendingActionId: action.id } })).rejects.toThrow();
    const usage = await db.aiUsageLog.create({ data: { callType: "description", userId: users.realtor1.userId, model: "synthetic" } });
    await db.aiChatMessage.create({ data: { sessionId: session.id, role: "assistant", content: "Предпросмотр", pendingActionId: action.id, aiUsageLogId: usage.id } });
    await expect(db.aiPendingAction.update({ where: { id: action.id }, data: { status: "confirmed" } })).rejects.toThrow();
    await db.aiPendingAction.update({ where: { id: action.id }, data: { status: "confirmed", decidedBy: users.realtor1.userId, decidedAt: new Date() } });
    const listing = await db.externalListing.create({ data: listingData });
    const cache = { cacheKey: "synthetic-description-criteria-model-hash", listingId: listing.id, result: { matched: true }, aiUsageLogId: usage.id };
    await db.aiAnalysisCache.create({ data: cache });
    await expect(db.aiAnalysisCache.create({ data: cache })).rejects.toThrow();
    await db.searchExport.create({ data: { userId: users.realtor1.userId, format: "xlsx", scope: "all_filtered", params: { sort: "publishedAt" }, columns: ["url", "publishedAt"], rowCount: 1 } });
    await expect(db.aiUsageLog.delete({ where: { id: usage.id } })).rejects.toThrow();
  });
});
