import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/modules/auth/domain/actor";
import * as scopes from "@/modules/access/domain/scopes";
import { pickCallContext } from "@/modules/requests/application/call-pickers";
import { previewResponsible } from "@/modules/requests/application/request-service";
import { executeTool, listingScope } from "@/modules/ai-chat/application/tools";
import { runChatLoop } from "@/modules/ai-chat/domain/loop";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";

const mocks = vi.hoisted(() => ({
  advertisement: { findMany: vi.fn(), findFirst: vi.fn() },
  property: { findMany: vi.fn(), findFirst: vi.fn() },
  externalListing: { findMany: vi.fn() },
  client: { findMany: vi.fn() },
}));
vi.mock("@/shared/db/client", () => ({ db: mocks, transaction: vi.fn() }));
const actor: Actor = { userId: "00000000-0000-4000-8000-000000000001", login: "test", displayName: "Сотрудник", role: "realtor", sessionId: "test", mustChangePassword: false };
const propertyId = "00000000-0000-4000-8000-000000000002";
const advertisementId = "00000000-0000-4000-8000-000000000003";
const otherId = "00000000-0000-4000-8000-000000000004";
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.advertisement.findMany.mockResolvedValue([]);
  mocks.property.findMany.mockResolvedValue([]);
  mocks.externalListing.findMany.mockResolvedValue([]);
  mocks.client.findMany.mockResolvedValue([]);
});

describe("Beam: call context scope and bounds", () => {
  it("combines external scope, ID and search without overwriting the scope OR", async () => {
    await pickCallContext(actor, { kind: "external", q: " cian ", id: propertyId, take: 1000 });
    expect(mocks.externalListing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 20,
      where: { AND: [listingScope(actor), { id: propertyId }, { OR: [
        { address: { contains: "cian", mode: "insensitive" } }, { source: { contains: "cian", mode: "insensitive" } },
      ] }] },
    }));
  });
  it("composes advertisement and property read scopes with query filters", async () => {
    vi.spyOn(scopes, "advertisementReadScope").mockReturnValue({ responsibleUserId: actor.userId });
    vi.spyOn(scopes, "propertyReadScope").mockReturnValue({ responsibleUserId: actor.userId });
    await pickCallContext(actor, { kind: "advertisement", q: "офис", id: advertisementId });
    const query = mocks.advertisement.findMany.mock.calls[0]![0];
    expect(query.take).toBe(20);
    expect(query.where.AND).toEqual(expect.arrayContaining([
      { responsibleUserId: actor.userId }, { id: advertisementId },
      { property: { AND: [{ responsibleUserId: actor.userId }, { archivedAt: null, status: { not: "archived" } }] } },
    ]));
  });
  it.each(["external", "advertisement"])("rejects oversized %s query before reading data", async kind => {
    await expect(pickCallContext(actor, { kind, q: "x".repeat(201) })).rejects.toMatchObject({ status: 400 });
    expect(mocks.externalListing.findMany).not.toHaveBeenCalled();
    expect(mocks.advertisement.findMany).not.toHaveBeenCalled();
  });
});

describe("Beam: responsible preview", () => {
  it("applies property scope and returns 404 rather than a fallback for denied IDs", async () => {
    vi.spyOn(scopes, "propertyReadScope").mockReturnValue({ responsibleUserId: actor.userId });
    mocks.property.findFirst.mockResolvedValue(null);
    await expect(previewResponsible(actor, { propertyId })).rejects.toMatchObject({ status: 404 });
    expect(mocks.property.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: propertyId, AND: [{ responsibleUserId: actor.userId }, { archivedAt: null, status: { not: "archived" } }],
    } }));
  });
  it("applies advertisement scope and returns 404 for a denied ad", async () => {
    vi.spyOn(scopes, "advertisementReadScope").mockReturnValue({ responsibleUserId: actor.userId });
    mocks.advertisement.findFirst.mockResolvedValue(null);
    await expect(previewResponsible(actor, { advertisementId })).rejects.toMatchObject({ status: 404 });
    expect(mocks.advertisement.findFirst.mock.calls[0]![0].where.AND).toContainEqual({ responsibleUserId: actor.userId });
  });
  it("does not let an advertisement replace an inaccessible explicit property", async () => {
    mocks.property.findFirst.mockResolvedValue(null);
    await expect(previewResponsible(actor, { propertyId, advertisementId })).rejects.toMatchObject({ status: 404 });
    expect(mocks.advertisement.findFirst).not.toHaveBeenCalled();
  });
  it("rejects conflicting property and advertisement IDs", async () => {
    mocks.property.findFirst.mockResolvedValue({ id: propertyId });
    mocks.advertisement.findFirst.mockResolvedValue({ property: { id: otherId } });
    await expect(previewResponsible(actor, { propertyId, advertisementId })).rejects.toMatchObject({ status: 400 });
  });
  it("shows the rule without another employee's name or ID", async () => {
    mocks.property.findFirst.mockResolvedValue({ id: propertyId, responsible: { id: otherId, displayName: "Закрытое имя" } });
    const result = await previewResponsible(actor, { propertyId });
    expect(result).toEqual({ byPropertyRule: true, responsible: { id: "", displayName: "Ответственный объекта" } });
    expect(JSON.stringify(result)).not.toMatch(/Закрытое имя|000000000004/);
  });
  it("retains the self fallback only for absent context or an accessible unassigned property", async () => {
    const expected = { responsible: { id: actor.userId, displayName: actor.displayName }, byPropertyRule: false };
    expect(await previewResponsible(actor, {})).toEqual(expected);
    mocks.property.findFirst.mockResolvedValue({ id: propertyId, responsible: null });
    expect(await previewResponsible(actor, { propertyId })).toEqual(expected);
  });
});

describe("Beam: listing descriptions sent to the provider", () => {
  it.each([
    "офис 80 м²; +7 (900) 123-45-67; seller@example.test; контакт Иван Петров",
    "x".repeat(592) + " +7 (900) 123-45-67 seller@example.test",
  ])("redacts contacts before truncation and before the fake provider request", async description => {
    mocks.externalListing.findMany.mockResolvedValue([{ id: propertyId, address: "ул. Тестовая, 1", description, areaM2: "80", priceRub: "100000", priceUnit: "per_month", floorNumber: 1 }]);
    const fake = new FakeResponsesProvider(r => r.inputItems?.length === 1
      ? { functionCalls: [{ type: "function_call", call_id: "listing", name: "find_listings", arguments: "{}" }] }
      : { text: "Готово" });
    await runChatLoop([{ role: "user", content: "офис" }], r => fake.respond(r), (name, args) => executeTool(actor, "session", name, args), "test");
    expect(fake.requests).toHaveLength(2);
    const request = JSON.stringify(fake.requests[1]);
    expect(request).not.toMatch(/900|123-45|seller|example|Иван|Петров|\+7/);
    expect(request).toContain("[PHONE]");
    const output = fake.requests[1]?.inputItems?.find(item => "output" in item);
    if (!output || !("output" in output)) throw new Error("Missing function output");
    expect(JSON.parse(output.output).untrusted_data[0]).toMatchObject({ area: "80", price: "100000" });
  });
});
