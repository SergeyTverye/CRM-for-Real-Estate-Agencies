import { beforeEach, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { db, makeClient, makeNeed, makeProperty, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { getNeedCard, listNeeds } from "@/modules/needs/application/need-queries";
import { getRequestCard, listRequests } from "@/modules/requests/application/request-queries";
import { getAgreement, listAgreements } from "@/modules/agreements/application/agreement-service";
import { getDeal, listDeals } from "@/modules/deals/application/deal-service";
import { getShowing, listShowings } from "@/modules/showings/application/showing-service";
import { getOffer, listOffers } from "@/modules/commercial-offers/application/offer-service";
import { getTask, getTodayView, listTasks, listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { getClientCard, getClientTimeline } from "@/modules/clients/application/client-queries";
import { globalSearch } from "@/modules/search/application/search-service";
import { exportData } from "@/modules/export/application/export-service";
import { getManagerReport } from "@/modules/reports/application/report-service";
import { listDocumentsFor, openDocumentForDownload, storeDocument } from "@/modules/documents/application/document-service";
import { GET as downloadRoute } from "@/app/api/v1/documents/[id]/download/route";
import { apiRequest, routeParams, sessionCookieFor } from "../helpers/fixtures";

const SECRET = "PrivateClientP0";
let u: TestUsers;
let clientId: string, needId: string, propertyId: string;

beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
  clientId = (await makeClient(u.realtor1, { displayName: SECRET })).id;
  needId = (await makeNeed(u.realtor1, clientId)).id;
  propertyId = (await makeProperty(u.realtor2)).id;
});

function hidden(value: unknown) {
  const json = JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v);
  expect(json).not.toContain(SECRET);
  expect(json).not.toContain(clientId);
}

it("need card/list redact the assigned foreign client including contacts; owner and manager keep access", async () => {
  await db.clientNeed.update({ where: { id: needId }, data: { responsibleUserId: u.realtor2.userId } });
  const card = await getNeedCard(u.realtor2, needId);
  expect(card.clientVisible).toBe(false);
  expect(card.need.client).toBeNull();
  hidden(card);
  hidden(await listNeeds(u.realtor2, {}));
  expect((await listNeeds(u.realtor2, { q: SECRET })).total).toBe(0);
  for (const actor of [u.realtor1, u.manager]) {
    expect((await getNeedCard(actor, needId)).need.client?.displayName).toBe(SECRET);
    expect((await getNeedCard(actor, needId)).need.client?.contacts.length).toBeGreaterThan(0);
  }
});

it("requests redact client, inaccessible need and its next action in card/list and name filters", async () => {
  const request = await db.leadRequest.create({ data: {
    clientId, clientNeedId: needId, responsibleUserId: u.realtor2.userId, createdBy: u.realtor1.userId,
    occurredAt: new Date(), channelCode: "phone", sourceCode: "other", resultCode: "new_need", statusCode: "open", summary: "Public request",
  } });
  const card = await getRequestCard(u.realtor2, request.id);
  expect(card.request.client).toBeNull();
  expect(card.request.need).toBeNull();
  hidden(card);
  hidden(await listRequests(u.realtor2, {}));
  expect((await listRequests(u.realtor2, { q: SECRET })).total).toBe(0);
  expect((await getRequestCard(u.manager, request.id)).request.client?.displayName).toBe(SECRET);
});

it("agreement access through property never exposes the foreign client", async () => {
  const a = await db.agreement.create({ data: { clientId, propertyId, responsibleUserId: u.realtor1.userId, agreementType: "information", status: "draft" } });
  hidden(await getAgreement(u.realtor2, a.id));
  hidden(await listAgreements(u.realtor2, {}));
  expect((await listAgreements(u.realtor2, { q: SECRET })).total).toBe(0);
  for (const actor of [u.realtor1, u.manager]) expect((await getAgreement(actor, a.id)).agreement.client?.displayName).toBe(SECRET);
});

it("deal parties and nested commission payer redact client and clientId", async () => {
  const deal = await db.deal.create({ data: { propertyId, responsibleUserId: u.realtor2.userId, createdBy: u.manager.userId, legalEntityId: u.llcId, status: "draft" } });
  const party = await db.dealParty.create({ data: { dealId: deal.id, clientId, partyRole: "buyer", comment: SECRET, externalPartyName: SECRET } });
  await db.dealCommission.create({ data: { dealId: deal.id, payerPartyId: party.id, amount: "100", status: "planned" } });
  hidden(await getDeal(u.realtor2, deal.id));
  hidden(await listDeals(u.realtor2, {}));
  for (const actor of [u.realtor1, u.manager]) {
    const card = await getDeal(actor, deal.id);
    expect(card.deal.parties[0]?.client?.displayName).toBe(SECRET);
    expect(card.deal.commissions[0]?.payer?.client?.displayName).toBe(SECRET);
  }
});

it("showing and offer cards/lists redact the foreign client", async () => {
  const showing = await db.showing.create({ data: { propertyId, clientNeedId: needId, responsibleUserId: u.realtor2.userId, createdBy: u.manager.userId, scheduledAt: new Date(), status: "planned" } });
  const offer = await db.commercialOffer.create({ data: { clientNeedId: needId, responsibleUserId: u.realtor2.userId, createdBy: u.manager.userId, status: "draft" } });
  hidden(await getShowing(u.realtor2, showing.id));
  hidden(await listShowings(u.realtor2, {}));
  hidden(await getOffer(u.realtor2, offer.id));
  hidden(await listOffers(u.realtor2, {}));
  expect((await listOffers(u.realtor2, { q: SECRET })).total).toBe(0);
  expect((await getShowing(u.manager, showing.id)).showing.need.client?.displayName).toBe(SECRET);
  expect((await getOffer(u.realtor1, offer.id)).offer.need.client?.displayName).toBe(SECRET);
});

it("property raw matches cannot bypass the redacted matches DTO", async () => {
  await db.clientNeed.update({ where: { id: needId }, data: { responsibleUserId: u.realtor2.userId } });
  await db.needPropertyMatch.create({ data: { clientNeedId: needId, propertyId, offeredAt: new Date(), sourceCode: "manual", status: "proposed", createdBy: u.manager.userId } });
  hidden(await getPropertyCard(u.realtor2, propertyId));
});

it("linked tasks require taskScope and need labels do not reveal foreign client; today uses same DTO", async () => {
  await db.clientNeed.update({ where: { id: needId }, data: { responsibleUserId: u.realtor2.userId } });
  const task = await db.task.create({ data: { responsibleUserId: u.realtor2.userId, createdBy: u.manager.userId, taskType: "call_or_contact", title: "Public action", dueAt: new Date(), status: "planned", priority: "normal", needLinks: { create: { clientNeedId: needId } } } });
  hidden(await getTask(u.realtor2, task.id));
  hidden(await listTasks(u.realtor2, {}));
  hidden(await getTodayView(u.realtor2));
  const linked = await listTasksLinkedTo(u.realtor2, { needId }, { includeClosed: true });
  expect(linked.map(t => t.id)).toEqual([task.id]);
  expect((await listTasksLinkedTo(u.manager, { needId })).length).toBeGreaterThan(1);
});

it("direct foreign IDs, communications timeline, global search, reports and ZIP export enforce RBAC", async () => {
  await expect(getClientCard(u.realtor2, clientId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getClientTimeline(u.realtor2, clientId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getNeedCard(u.realtor2, needId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  hidden(await globalSearch(u.realtor2, SECRET));
  for (const actor of [u.realtor1, u.realtor2]) {
    await expect(exportData(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getManagerReport(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  const zip = unzipSync((await exportData(u.manager)).data);
  expect(strFromU8(zip["clients.csv"]!)).toContain(SECRET);
  expect(strFromU8(zip["client_contacts.csv"]!)).toContain(clientId);
  expect((await globalSearch(u.manager, SECRET)).groups[0]?.items[0]?.title).toBe(SECRET);
});

it("foreign deal, agreement, showing, offer and task IDs remain inaccessible", async () => {
  const property = (await makeProperty(u.realtor1)).id;
  const deal = await db.deal.create({ data: { propertyId: property, responsibleUserId: u.realtor1.userId, createdBy: u.realtor1.userId, legalEntityId: u.llcId, status: "draft" } });
  const agreement = await db.agreement.create({ data: { clientId, responsibleUserId: u.realtor1.userId, agreementType: "information", status: "draft" } });
  const showing = await db.showing.create({ data: { propertyId: property, clientNeedId: needId, responsibleUserId: u.realtor1.userId, createdBy: u.realtor1.userId, scheduledAt: new Date(), status: "planned" } });
  const offer = await db.commercialOffer.create({ data: { clientNeedId: needId, responsibleUserId: u.realtor1.userId, createdBy: u.realtor1.userId, status: "draft" } });
  const task = await db.task.findFirstOrThrow({ where: { responsibleUserId: u.realtor1.userId } });
  const readers = [getDeal, getAgreement, getShowing, getOffer, getTask];
  const ids = [deal.id, agreement.id, showing.id, offer.id, task.id];
  for (const [index, read] of readers.entries()) {
    await expect(read(u.realtor2, ids[index]!)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(read(u.manager, ids[index]!)).resolves.toBeDefined();
  }
});

it.each(["photo", "agreement"] as const)("protected %s file cannot be opened via an additional public property link", async documentTypeCode => {
  const doc = await storeDocument(u.realtor1.userId, { data: Buffer.from("private synthetic file"), originalName: `${SECRET}.png`, mimeType: "image/png", documentTypeCode, link: { kind: "client", id: clientId }, legalEntityId: null });
  await db.documentProperty.create({ data: { documentId: doc.id, propertyId } });
  expect(await listDocumentsFor(u.realtor2, { kind: "property", id: propertyId })).toEqual([]);
  await expect(openDocumentForDownload(u.realtor2, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const response = await downloadRoute(apiRequest("GET", `/api/v1/documents/${doc.id}/download`, { cookie: await sessionCookieFor(u.realtor2) }), routeParams({ id: doc.id }));
  expect(response.status).toBe(404);
  const opened = await openDocumentForDownload(u.manager, doc.id);
  let contents = "";
  for await (const chunk of opened.stream) contents += chunk.toString();
  expect(contents).toBe("private synthetic file");
});

it("property-only files respect photo classification, grant and immediate revocation", async () => {
  const foreignProperty = (await makeProperty(u.realtor1)).id;
  const photo = await storeDocument(u.realtor1.userId, { data: Buffer.from("photo"), originalName: "photo.png", mimeType: "image/png", documentTypeCode: "photo", link: { kind: "property", id: foreignProperty }, legalEntityId: null });
  const scan = await storeDocument(u.realtor1.userId, { data: Buffer.from("scan"), originalName: "scan.png", mimeType: "image/png", documentTypeCode: "agreement", link: { kind: "property", id: foreignProperty }, legalEntityId: null });
  (await openDocumentForDownload(u.realtor2, photo.id)).stream.destroy();
  await expect(openDocumentForDownload(u.realtor2, scan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const grant = await db.propertyContactGrant.create({ data: { propertyId: foreignProperty, userId: u.realtor2.userId, grantedBy: u.manager.userId } });
  (await openDocumentForDownload(u.realtor2, scan.id)).stream.destroy();
  await db.propertyContactGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  await expect(openDocumentForDownload(u.realtor2, scan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
