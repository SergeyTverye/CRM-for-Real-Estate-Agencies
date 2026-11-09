import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { uploadPropertyMedia } from "@/modules/properties/application/property-media-service";
import { exportRegister } from "@/modules/export/application/register-export";
import { scheduleShowing } from "@/modules/showings/application/showing-service";
import { unzipSync, strFromU8 } from "fflate";
import { db, makeClient, makeNeed, makeProperty, resetDatabase, seedBase, inDays, type TestUsers } from "../helpers/fixtures";
import { changeNeedState } from "@/modules/needs/application/need-service";
import { completeTask, cancelTask, updateTask } from "@/modules/tasks/application/task-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { getManagerReport, getReportDetail } from "@/modules/reports/application/report-service";
import { createOffer, createOfferRevision, getOffer, updateOffer, changeOfferStatus } from "@/modules/commercial-offers/application/offer-service";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";
import { createDeal, closeDeal } from "@/modules/deals/application/deal-service";
import { getChecklist, initializeChecklist, updateChecklistItem } from "@/modules/deals/application/checklist-service";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";
import { getContactControl } from "@/modules/requests/application/contact-control";
let u: TestUsers;
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
async function paused() {
 const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id);
 const need = await db.clientNeed.findUniqueOrThrow({ where: { id: n.id } });
 await changeNeedState(u.realtor1, n.id, { expectedUpdatedAt: need.updatedAt.toISOString(), status: "paused", returnTask: { title: "Return", dueAt: inDays(1) } });
 const task = await db.task.findFirstOrThrow({ where: { taskType: "pause_return", needLinks: { some: { clientNeedId: n.id } } } });
 return { c, n, task };
}
describe("P1A workflow", () => {
 it("detects foreign checklist document references and source/time boundary exclusions", async () => {
  const client = await makeClient(u.realtor1); const property = await makeProperty(u.realtor1);
  const deal = await createDeal(u.realtor1, { propertyId: property.id, legalEntityId: u.llcId, parties: [{ clientId: client.id, partyRole: "tenant" }] });
  await initializeChecklist(u.realtor1, deal.id); const item = (await getChecklist(u.realtor1, deal.id)).items[0]!;
  const { attachGeneratedDocument } = await import("@/modules/documents/application/document-service");
  const doc = await attachGeneratedDocument(u.realtor1, { data: Buffer.from("synthetic material"), originalName: "material.txt", mimeType: "text/plain", documentTypeCode: "other", link: { kind: "property", id: property.id } });
  await expect(updateChecklistItem(u.realtor1, deal.id, item.id, { expectedUpdatedAt: item.updatedAt.toISOString(), status: "review", documentId: doc.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await db.documentDeal.create({ data: { documentId: doc.id, dealId: deal.id } });
  await updateChecklistItem(u.realtor1, deal.id, item.id, { expectedUpdatedAt: item.updatedAt.toISOString(), status: "review", documentId: doc.id });
  expect((await getChecklist(u.realtor1, deal.id)).items[0]!.documentId).toBe(doc.id);
  const need = await makeNeed(u.realtor1, client.id);
  const request = (at: string, sourceCode: string) => registerRequest(u.realtor1, { occurredAt: at, channelCode: "phone", sourceCode, client: { mode: "existing", clientId: client.id }, outcome: { resultCode: "linked_existing_need", needId: need.id, nextAction: { title: "Contact", dueAt: inDays(1) } } });
  await request("2026-06-01T20:59:59.999Z", "avito");
  await request("2026-06-01T21:00:00.000Z", "avito");
  await request("2026-06-02T20:59:59.999Z", "avito");
  await request("2026-06-02T21:00:00.000Z", "avito");
  await request("2026-06-02T12:00:00.000Z", "cian");
  const report = await getManagerReport(u.manager, { from: "2026-06-02", to: "2026-06-02", sourceCode: "avito", userId: u.realtor1.userId });
  expect(report.kpis.find(k => k.key === "newRequests")!.value).toBe(2);
  expect(report.cohorts.requestsWithNeed).toHaveLength(1);
  expect(report.requestsBySource).toHaveLength(1);
 });

 it("requires special return tasks; rollback and replacement are atomic", async () => {
  const { n, task } = await paused();
  await expect(completeTask(u.realtor1, task.id, { expectedUpdatedAt: task.updatedAt.toISOString() })).rejects.toMatchObject({ status: 409, code: "RETURN_TASK_REQUIRED" });
  await expect(cancelTask(u.realtor1, task.id, { expectedUpdatedAt: task.updatedAt.toISOString(), nextTask: { title: "Ordinary", dueAt: inDays(2) } })).rejects.toMatchObject({ code: "RETURN_TASK_REQUIRED" });
  expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("planned");
  const moved = await updateTask(u.realtor1, task.id, { expectedUpdatedAt: task.updatedAt.toISOString(), dueAt: inDays(3) });
  const current = await db.task.findUniqueOrThrow({ where: { id: moved.id } });
  await cancelTask(u.realtor1, task.id, { expectedUpdatedAt: current.updatedAt.toISOString(), nextTask: { title: "Return 2", taskType: "pause_return", dueAt: inDays(4) } });
  expect(await db.task.count({ where: { taskType: "pause_return", status: "planned", needLinks: { some: { clientNeedId: n.id } } } })).toBe(1);
 });
 it("supports recurrence and changing paused status within task completion", async () => {
  const { n, task } = await paused();
  await db.task.update({ where: { id: task.id }, data: { recurrenceKind: "monthly" } });
  let t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  const done = await completeTask(u.realtor1, t.id, { expectedUpdatedAt: t.updatedAt.toISOString() });
  expect((await db.task.findUniqueOrThrow({ where: { id: done.nextInstanceId! } })).taskType).toBe("pause_return");
  t = await db.task.findUniqueOrThrow({ where: { id: done.nextInstanceId! } });
  await cancelTask(u.realtor1, t.id, { expectedUpdatedAt: t.updatedAt.toISOString(), needChanges: [{ needId: n.id, change: { status: "closed", stopReasonCode: "other", stopComment: "Resolved", cancelOpenTasks: false } }] });
  expect((await db.clientNeed.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("closed");
 });
 it("requires next contact for prospective requests and a reason for terminal outcomes", async () => {
  const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id);
  const input = { occurredAt: inDays(0), channelCode: "phone", sourceCode: "avito", client: { mode: "existing", clientId: c.id } };
  await expect(registerRequest(u.realtor1, { ...input, outcome: { resultCode: "linked_existing_need", needId: n.id } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(registerRequest(u.realtor1, { ...input, outcome: { resultCode: "invalid_or_spam" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const r = await registerRequest(u.realtor1, { ...input, outcome: { resultCode: "linked_existing_need", needId: n.id, nextAction: { title: "Contact", dueAt: inDays(1) } } });
  const currentNeed = await db.clientNeed.findUniqueOrThrow({ where: { id: n.id } });
  await expect(changeNeedState(u.realtor1, n.id, { expectedUpdatedAt: currentNeed.updatedAt.toISOString(), status: "closed", stopReasonCode: "no_match" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(r.taskId).toBeTruthy(); expect((await db.clientNeed.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("active");
 });
 it("copies historical snapshots to a draft revision and emits real DOCX links", async () => {
  const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id); const p = await makeProperty(u.realtor1);
  const o = await createOffer(u.realtor1, { clientNeedId: n.id, legalEntityId: u.llcId, items: [{ propertyId: p.id }] });
  let original = (await getOffer(u.realtor1, o.id)).offer;
  await changeOfferStatus(u.realtor1, o.id, { expectedUpdatedAt: original.updatedAt.toISOString(), status: "sent" });
  original = (await getOffer(u.realtor1, o.id)).offer;
  await db.property.update({ where: { id: p.id }, data: { price: "999999" } });
  const revision = await createOfferRevision(u.realtor1, o.id, { expectedUpdatedAt: original.updatedAt.toISOString() });
  const copy = (await getOffer(u.realtor1, revision.id)).offer;
  expect(copy.status).toBe("draft"); expect(copy.sentAt).toBeNull(); expect(copy.promptTemplateVersion).toBe(`revision-of:${o.id}`); expect(copy.items[0]!.priceSnapshot?.toString()).toBe("100000");
  const second = await makeProperty(u.realtor1);
  await updateOffer(u.realtor1, copy.id, { expectedUpdatedAt: copy.updatedAt.toISOString(), items: [{ propertyId: second.id }, { propertyId: p.id }] });
  const saved = (await getOffer(u.realtor1, copy.id)).offer;
  expect(saved.items[1]!.priceSnapshot?.toString()).toBe("100000");
  const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } }).png().toBuffer();
  await uploadPropertyMedia(u.realtor1, p.id, new File([new Uint8Array(image)], "synthetic.png", { type: "image/png" }), { kind: "photo" });
  await db.legalEntity.update({ where: { id: u.llcId }, data: { requisites: "ИНН 0000000000 — синтетический пример" } });
  const doc = await generateOfferDocument(u.realtor1, copy.id, "https://crm.test");
  const file = await openDocumentForDownload(u.realtor1, doc.id); const chunks: Buffer[] = []; for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
  const zip = unzipSync(Buffer.concat(chunks)); expect(Object.keys(zip).some(k => k.startsWith("word/media/") && k.endsWith(".png"))).toBe(true); expect(strFromU8(zip["word/document.xml"]!)).toContain("0000000000"); expect(strFromU8(zip["word/_rels/document.xml.rels"]!)).toContain(`https://crm.test/properties/${p.id}`);
 });
 it("supports checklist status/version and chosen postdeal task context", async () => {
  const c = await makeClient(u.realtor1); const p = await makeProperty(u.realtor1);
  const d = await createDeal(u.realtor1, { propertyId: p.id, legalEntityId: u.llcId, parties: [{ clientId: c.id, partyRole: "tenant" }] });
  await initializeChecklist(u.realtor1, d.id); await initializeChecklist(u.realtor1, d.id);
  const list = await getChecklist(u.realtor1, d.id); expect(list.items).toHaveLength(9);
  const i = list.items[0]!; await updateChecklistItem(u.realtor1, d.id, i.id, { expectedUpdatedAt: i.updatedAt.toISOString(), status: "verified", responsibleUserId: u.realtor1.userId });
  expect((await getChecklist(u.realtor1, d.id)).items[0]!.checkedAt).not.toBeNull();
  await expect(updateChecklistItem(u.realtor1, d.id, i.id, { expectedUpdatedAt: i.updatedAt.toISOString(), status: "review" })).rejects.toMatchObject({ code: "STALE_UPDATE" });
  const deal = await db.deal.findUniqueOrThrow({ where: { id: d.id } });
  const closed = await closeDeal(u.realtor1, d.id, { expectedUpdatedAt: deal.updatedAt.toISOString(), status: "completed", postdealTasks: [{ subtypeCode: "followup", title: "Follow up", responsibleUserId: u.realtor1.userId, dueAt: inDays(30) }] });
  const task = await db.task.findUniqueOrThrow({ where: { id: closed.taskIds[0]! }, include: { clientLinks: true, dealLinks: true, propertyLinks: true } });
  expect(task.clientLinks[0]!.clientId).toBe(c.id); expect(task.propertyLinks[0]!.propertyId).toBe(p.id); expect(task.dealLinks[0]!.dealId).toBe(d.id);
 });
 it("all KPI and funnel aggregates equal their unique detail rows with source/user/time filters", async () => {
  const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id);
  const lead = (at: string) => registerRequest(u.realtor1, { occurredAt: at, channelCode: "phone", sourceCode: "avito", client: { mode: "existing", clientId: c.id }, outcome: { resultCode: "linked_existing_need", needId: n.id, nextAction: { title: "Contact", dueAt: inDays(1) } } });
  await lead(inDays(-1)); await lead(inDays(0));
  await db.task.create({ data: { title: "On time", priority: "normal", taskType: "call_or_contact", dueAt: new Date(), status: "completed", completedAt: new Date(Date.now() - 1000), responsibleUserId: u.realtor1.userId, createdBy: u.realtor1.userId, clientLinks: { create: { clientId: c.id } } } });
  await db.task.create({ data: { title: "Late", priority: "normal", taskType: "call_or_contact", dueAt: new Date(Date.now() - 10000), status: "completed", completedAt: new Date(), responsibleUserId: u.realtor1.userId, createdBy: u.realtor1.userId, clientLinks: { create: { clientId: c.id } } } });
  const f = { from: inDays(-2).slice(0,10), to: inDays(2).slice(0,10), userId: u.realtor1.userId, sourceCode: "avito" };
  const property = await makeProperty(u.realtor1);
  await scheduleShowing(u.realtor1, { clientNeedId: n.id, propertyId: property.id, scheduledAt: inDays(0.1) });
  const offer = await createOffer(u.realtor1, { clientNeedId: n.id, legalEntityId: u.llcId, items: [{ propertyId: property.id }] });
  const offerRow = await db.commercialOffer.findUniqueOrThrow({ where: { id: offer.id } });
  await changeOfferStatus(u.realtor1, offer.id, { expectedUpdatedAt: offerRow.updatedAt.toISOString(), status: "sent" });
  await db.commercialOffer.update({ where: { id: offer.id }, data: { createdAt: new Date(inDays(-100)) } });
  const deal = await createDeal(u.realtor1, { propertyId: property.id, legalEntityId: u.llcId, parties: [{ clientId: c.id, partyRole: "tenant" }], commissions: [{ amount: "200.25", status: "received" }, { amount: "100.10", status: "received" }] });
  const dealRow = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
  await closeDeal(u.realtor1, deal.id, { expectedUpdatedAt: dealRow.updatedAt.toISOString(), status: "completed" });
  await db.deal.update({ where: { id: deal.id }, data: { openedAt: new Date(inDays(-100)) } });
  const rep = await getManagerReport(u.manager, f);
  for (const k of rep.kpis) { const detail = await getReportDetail(u.manager, k.key, f); expect(k.value, k.key).toBe(detail.rows.length); }
  for (const [key, count] of Object.entries(rep.funnel)) expect(count, key).toBe(rep.cohorts[key === "requests" ? "newRequests" : key]!.length);
  for (const group of [...rep.requestsBySource, ...rep.requestsByChannel, ...rep.showings.byStatus, ...rep.showings.byResult, ...rep.needs.closedByReason]) {
    const params = new URL(group.href, "https://crm.test").searchParams;
    expect((await getReportDetail(u.manager, params.get("metric")!, f)).total).toBe(group.count);
  }
  for (const rows of Object.values(rep.cohorts)) expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
  expect(rep.funnel.requestsWithNeed).toBe(1); expect(rep.funnel.offersSent).toBe(1); expect(rep.funnel.dealsOpened).toBe(0); expect(rep.funnel.dealsCompleted).toBe(1); expect(rep.commissionsReceived).toBe("300.35");
  for (const key of ["requestsWithNeed", "requestToShowing", "offersSent", "offersToShowing", "offersToDeal", "commissions"]) expect((await getReportDetail(u.manager, key, f)).total).toBe(rep.cohorts[key]!.length);
  expect((await exportRegister(u.manager, "deals", { status: "completed" })).count).toBe(1);
  expect((await exportRegister(u.manager, "commissions", { ...f, responsibleUserId: f.userId, status: "received" })).count).toBe(2);
  expect((await exportRegister(u.manager, "deals", { status: "draft" })).count).toBe(0); expect(rep.contactControl.actionShare).toBe(100); expect(rep.contactControl.onTimeShare).toBe(50);
  await db.task.updateMany({ where: { status: "planned" }, data: { dueAt: new Date(Date.now() - 10000) } });
  expect((await getContactControl(u.manager)).requests).toHaveLength(2);
 });
});
