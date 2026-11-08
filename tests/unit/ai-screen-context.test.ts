import { describe, it, expect, vi } from "vitest";
import { pageContext, contextSchema, quickQuestions, taskFormHref } from "@/modules/ai-chat/domain/context";
import { safeText } from "@/modules/ai-chat/domain/policy";
const mocks = vi.hoisted(() => ({ db: { client: { findFirst: vi.fn() }, clientNeed: { findMany: vi.fn() }, task: { findMany: vi.fn(), count: vi.fn() }, communication: { findMany: vi.fn() }, showing: { findMany: vi.fn() }, needStageHistory: { findMany: vi.fn() } } }));
vi.mock("@/shared/db/client", () => ({ db: mocks.db }));
vi.mock("@/modules/reports/application/report-service", () => ({ getManagerReport: vi.fn() }));
import { assembleScreenContext } from "@/modules/ai-chat/application/screen-context";
const id = "00000000-0000-4000-8000-000000000001";
const actor = { userId: id, role: "realtor" as const, login: "test", displayName: "test", mustChangePassword: false, sessionId: id };
describe("screen context", () => {
  it.each(["clients", "needs", "tasks", "deals", "agreements", "collections"])("recognizes %s detail and rejects new form", path => {
    expect(pageContext(`/${path}/${id}`)).toHaveProperty("id", id);
    expect(pageContext(`/${path}/new`)).toEqual({ kind: "none" });
  });
  it("recognizes Today and reports, validates route metadata and provides different questions", () => {
    expect(pageContext("/today")).toEqual({ kind: "today" });
    expect(pageContext("/reports/detail")).toEqual({ kind: "reports" });
    expect(contextSchema.safeParse({ kind: "today", id }).success).toBe(false);
    expect(contextSchema.safeParse({ kind: "task" }).success).toBe(false);
    expect(contextSchema.safeParse({ kind: "client", id, content: "secret" }).success).toBe(false);
    expect(quickQuestions("client")).not.toEqual(quickQuestions("deal"));
    expect(taskFormHref({ kind: "need", id })).toBe(`/tasks/new?needId=${id}`);
    expect(taskFormHref({ kind: "today" })).toBe("/tasks/new");
  });
  it("selects only minimized structural client facts, never notes, contacts or credentials", async () => {
    mocks.db.client.findFirst.mockResolvedValue({ id, status: "active" });
    mocks.db.clientNeed.findMany.mockResolvedValue([]);
    mocks.db.task.findMany.mockResolvedValue([]); mocks.db.task.count.mockResolvedValue(0);
    mocks.db.communication.findMany.mockResolvedValue([]); mocks.db.showing.findMany.mockResolvedValue([]); mocks.db.needStageHistory.findMany.mockResolvedValue([]);
    const result = await assembleScreenContext(actor, { kind: "client", id });
    expect(result.data).toMatchObject({ client: { id }, tasks: [], needs: [] });
    for (const call of [mocks.db.client.findFirst, mocks.db.clientNeed.findMany, mocks.db.task.findMany, mocks.db.communication.findMany, mocks.db.showing.findMany, mocks.db.needStageHistory.findMany]) {
      expect(JSON.stringify(call.mock.calls.at(-1)?.[0].select)).not.toMatch(/password|token|passport|contact|owner|notes|comment|description|displayName|participantsText/i);
    }
  });
  it("rejects foreign client before collecting its history", async () => {
    vi.clearAllMocks(); mocks.db.client.findFirst.mockResolvedValue(null);
    await expect(assembleScreenContext(actor, { kind: "client", id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.db.communication.findMany).not.toHaveBeenCalled();
  });
  it("filters pasted passport, registration, passwords, tokens and owner contacts", () => {
    const text = safeText("паспорт 1234 567890; регистрация адрес; password=secretPassword; token=secretToken; +7 900 123-45-67; owner@example.com");
    expect(text).not.toMatch(/1234|567890|адрес|secretPassword|secretToken|900|owner@example/);
  });
});
