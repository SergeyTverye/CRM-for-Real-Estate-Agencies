import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "@/modules/auth/domain/actor";

const mocks = vi.hoisted(() => {
  const table = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), count: vi.fn() });
  return { db: { client: table(), clientNeed: table(), leadRequest: table(), agreement: table(), deal: table(), showing: table(), commercialOffer: table(), task: table(), property: table(), propertyOwner: table(), document: table() } };
});
vi.mock("@/shared/db/client", () => ({ db: mocks.db }));

import { getNeedCard, listNeeds } from "@/modules/needs/application/need-queries";
import { getRequestCard, listRequests } from "@/modules/requests/application/request-queries";
import { getAgreement, listAgreements } from "@/modules/agreements/application/agreement-service";
import { getDeal } from "@/modules/deals/application/deal-service";
import { getShowing, listShowings } from "@/modules/showings/application/showing-service";
import { getOffer, listOffers } from "@/modules/commercial-offers/application/offer-service";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { listTasksLinkedTo, toTaskView } from "@/modules/tasks/application/task-queries";
import { redactClientLink } from "@/modules/access/application/redact-client";
import { documentScope, taskScope } from "@/modules/access/domain/scopes";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";
import { globalSearch } from "@/modules/search/application/search-service";
import { exportData } from "@/modules/export/application/export-service";
import { getManagerReport } from "@/modules/reports/application/report-service";

const ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "PrivateClientP0";
const client = { id: "private-client-id", displayName: SECRET, responsibleUserId: "realtor1", contacts: [{ rawValue: "private-phone" }], taskLinks: [] };
const actor: Actor = { userId: "realtor2", login: "two", displayName: "Two", role: "realtor", sessionId: ID, mustChangePassword: false };
const manager: Actor = { ...actor, role: "manager" };
const need = { id: ID, clientId: client.id, client, responsibleUserId: actor.userId, taskLinks: [], communications: [] };
const row = { ...need, need, parties: [{ client, clientId: client.id, comment: SECRET, externalPartyName: SECRET }], commissions: [{ payer: { client, externalPartyName: SECRET } }], property: { operationType: "rent" }, status: "draft", items: [], documentLinks: [] };

beforeEach(() => {
  vi.resetAllMocks();
  for (const table of Object.values(mocks.db)) {
    table.findFirst.mockResolvedValue(row);
    table.findUnique.mockResolvedValue(row);
    table.findUniqueOrThrow.mockResolvedValue(row);
    table.findMany.mockResolvedValue([row]);
    table.count.mockResolvedValue(1);
  }
  mocks.db.task.findMany.mockResolvedValue([]);
});

// Deliberately return unfiltered raw DB relations: assertions exercise the server DTO boundary.
it.each([
  ["need card", async () => (await getNeedCard(actor, ID)).need.client],
  ["need list", async () => (await listNeeds(actor, {})).items[0]?.client],
  ["request card", async () => (await getRequestCard(actor, ID)).request.client],
  ["request list", async () => (await listRequests(actor, {})).items[0]?.client],
  ["agreement card", async () => (await getAgreement(actor, ID)).agreement.client],
  ["agreement list", async () => (await listAgreements(actor, {})).items[0]?.client],
  ["showing card", async () => (await getShowing(actor, ID)).showing.need.client],
  ["showing list", async () => (await listShowings(actor, {})).items[0]?.need.client],
  ["offer card", async () => (await getOffer(actor, ID)).offer.need.client],
  ["offer list", async () => (await listOffers(actor, {})).items[0]?.need.client],
] as const)("%s removes foreign client instead of only setting a flag", async (_, run) => {
  expect(await run()).toBeNull();
});

it("redaction removes the entire client payload and scalar FK, preserves owner/manager payload", () => {
  const input = { clientId: client.id, client };
  expect(redactClientLink(actor, input)).toEqual({ clientId: null, client: null });
  expect(redactClientLink(manager, input)).toEqual(input);
  expect(redactClientLink({ ...actor, userId: "realtor1" }, input)).toEqual(input);
  expect(input.client.contacts[0]?.rawValue).toBe("private-phone");
});

it("deal parties and commission payer apply the same server boundary", async () => {
  const card = await getDeal(actor, ID);
  expect(card.deal.parties[0]?.client).toBeNull();
  expect(card.deal.parties[0]?.clientId).toBeNull();
  expect(card.deal.parties[0]?.comment).toBeNull();
  expect(card.deal.commissions[0]?.payer?.client).toBeNull();
  expect(card.deal.commissions[0]?.payer?.externalPartyName).toBeNull();
});

it("property raw matches do not retain private nested payload", async () => {
  mocks.db.property.findUnique.mockResolvedValue({ ...row, agreements: [], contactGrants: [], matches: [{ need }], showings: [] });
  mocks.db.propertyOwner.findMany.mockResolvedValue([]);
  const card = await getPropertyCard(actor, ID);
  expect(card.property.matches).toEqual([]);
  expect(card.matches[0]?.need.client.displayName).toBeNull();
});

it("linked task queries scope both open and closed rows", async () => {
  await listTasksLinkedTo(actor, { propertyId: ID }, { includeClosed: true });
  expect(mocks.db.task.findMany).toHaveBeenCalledTimes(2);
  for (const [query] of mocks.db.task.findMany.mock.calls) expect(query.where.AND).toContainEqual(taskScope(actor));
});

it("task/today relation labels cannot disclose the client behind an accessible need", () => {
  const task = { ...row, id: ID, responsible: { id: actor.userId, displayName: "Two" }, dueAt: new Date(), title: "Call", clientLinks: [{ client }], needLinks: [{ need }], propertyLinks: [], showingLinks: [], dealLinks: [], advertisementLinks: [], agreementLinks: [], offerLinks: [] };
  const view = toTaskView(actor, task as unknown as Parameters<typeof toTaskView>[1]);
  expect(JSON.stringify(view)).not.toContain(SECRET);
  expect(JSON.stringify(view)).not.toContain(client.id);
});

it("every download queries the current document policy before touching storage", async () => {
  mocks.db.document.findFirst.mockResolvedValue(null);
  await expect(openDocumentForDownload(actor, ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mocks.db.document.findFirst).toHaveBeenCalledWith({ where: { id: ID, ...documentScope(actor) } });
  const policy = documentScope(actor);
  expect(policy.AND).toEqual(expect.arrayContaining([
    expect.objectContaining({ clientLinks: expect.objectContaining({ none: expect.anything() }) }),
    expect.objectContaining({ dealLinks: expect.objectContaining({ none: expect.anything() }) }),
  ]));
  expect(documentScope(manager)).toEqual({});
});

it.each(["realtor1", "realtor2"])("%s cannot reach ZIP/CSV loaders or report drill-down", async userId => {
  const realtor = { ...actor, userId };
  await expect(exportData(realtor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(getManagerReport(realtor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const table of Object.values(mocks.db)) expect(table.findMany).not.toHaveBeenCalled();
});

it("global search applies client ownership to client names and duplicated party names", async () => {
  for (const table of Object.values(mocks.db)) table.findMany.mockResolvedValue([]);
  const result = await globalSearch(actor, SECRET);
  expect(result.groups.every(group => group.items.length === 0)).toBe(true);
  expect(mocks.db.client.findMany.mock.calls[0]?.[0].where.AND).toContainEqual({ responsibleUserId: actor.userId });
  expect(mocks.db.clientNeed.findMany.mock.calls[0]?.[0].where.AND).toContainEqual({ client: { responsibleUserId: actor.userId } });
  const query = mocks.db.deal.findMany.mock.calls[0]?.[0];
  expect(query.where.AND[1].OR).toContainEqual({ parties: { some: {
    externalPartyName: { contains: SECRET, mode: "insensitive" },
    OR: [{ clientId: null }, { client: { responsibleUserId: actor.userId } }],
  } } });
});
