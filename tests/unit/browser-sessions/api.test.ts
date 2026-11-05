import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { BrowserContext, Page } from "playwright-core";
import type { Actor } from "@/modules/auth/domain/actor";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { MemorySessionRepository } from "@/modules/browser-sessions/infrastructure/memory-repository";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";

const auth = vi.hoisted(() => ({ actor: null as Actor | null }));
let service: BrowserSessionService;
vi.mock("@/modules/auth/application/session-service", () => ({ resolveSession: async () => auth.actor }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ isReadOnlyInstance: false }) }));
vi.mock("@/modules/browser-sessions/application/dependencies", () => ({ browserSessions: () => service }));
import { POST as create } from "@/app/api/v1/browser-sessions/route";
import { GET as get } from "@/app/api/v1/browser-sessions/[id]/route";
import { GET as frame } from "@/app/api/v1/browser-sessions/[id]/frame/route";
import { POST as inputRoute } from "@/app/api/v1/browser-sessions/[id]/input/route";
import { POST as complete } from "@/app/api/v1/browser-sessions/[id]/complete/route";
import { POST as cancel } from "@/app/api/v1/browser-sessions/[id]/cancel/route";

const actor: Actor = { userId: "10000000-0000-4000-8000-000000000001", sessionId: "fixture", displayName: "Тест", role: "realtor", login: "fixture", mustChangePassword: false };
const payload = { searchRunId: "20000000-0000-4000-8000-000000000001", source: "cian" };
function request(method: string, suffix = "", data?: unknown, origin = "http://localhost") {
  return new NextRequest(`http://localhost/api/v1/browser-sessions${suffix}`, { method,
    headers: { origin, host: "localhost", cookie: `${SESSION_COOKIE}=synthetic`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data) });
}
beforeEach(() => {
  auth.actor = actor;
  service = new BrowserSessionService(new MemorySessionRepository(), { open: async () => ({ page: {} as Page, context: {} as BrowserContext, frame: () => ({ sequence: 1, jpeg: "fixture", width: 1280, height: 800 }), input: async () => undefined, close: async () => undefined }) },
    { prepare: async () => ({ startUrl: "https://www.cian.ru/", parameters: {} }), isReady: async () => true, resume: async () => "completed", blocked: async () => undefined }, async () => undefined);
});
afterEach(async () => { await service.shutdown(); });
describe("real Next API wrappers for browser sessions", () => {
  it("requires authentication and same origin for create/input/complete/cancel", async () => {
    auth.actor = null; expect((await create(request("POST", "", payload), { params: Promise.resolve({}) })).status).toBe(401);
    auth.actor = actor;
    expect((await create(request("POST", "", payload, "https://foreign.example"), { params: Promise.resolve({}) })).status).toBe(403);
    const id = "30000000-0000-4000-8000-000000000001";
    for (const handler of [inputRoute, complete, cancel]) expect((await handler(request("POST", `/${id}/input`, {}, "https://foreign.example"), { params: Promise.resolve({ id }) })).status).toBe(403);
  });
  it("accepts only server-resolved URL and returns non-cacheable frames", async () => {
    const denied = await create(request("POST", "", { ...payload, startUrl: "http://127.0.0.1/" }), { params: Promise.resolve({}) }); expect(denied.status).toBe(400);
    const response = await create(request("POST", "", payload), { params: Promise.resolve({}) }); expect(response.status).toBe(200);
    const { id } = await response.json(); const result = await frame(request("GET", `/${id}/frame`), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({ frame: { jpeg: "fixture" } });
    expect((await get(request("GET", "/bad"), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
  });
  it.each(["realtor", "manager"] as const)("returns 404 for another %s on every direct API URL", async role => {
    const created = await create(request("POST", "", payload), { params: Promise.resolve({}) }); const { id } = await created.json();
    auth.actor = { ...actor, userId: "10000000-0000-4000-8000-000000000002", role };
    for (const handler of [get, frame]) expect((await handler(request("GET", `/${id}/frame`), { params: Promise.resolve({ id }) })).status).toBe(404);
    for (const handler of [inputRoute, complete, cancel]) expect((await handler(request("POST", `/${id}/input`, { type: "key", key: "Enter" }), { params: Promise.resolve({ id }) })).status).toBe(404);
  });
});
