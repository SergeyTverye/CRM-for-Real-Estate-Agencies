import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright-core";
import type { Actor } from "@/modules/auth/domain/actor";
import type { BrowserHandle, SearchContinuationPort, SessionAudit } from "@/modules/browser-sessions/domain/session";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { MemorySessionRepository } from "@/modules/browser-sessions/infrastructure/memory-repository";
import { allowsRequest } from "@/modules/browser-sessions/infrastructure/network-policy";
import { guardExternalUrl } from "@/shared/net/ssrf";

export const actor: Actor = { userId: "10000000-0000-4000-8000-000000000001", sessionId: "test", displayName: "Синтетический сотрудник", role: "realtor", login: "fixture", mustChangePassword: false };
export const input = { searchRunId: "20000000-0000-4000-8000-000000000001", source: "cian" as const };
function setup(options: { ready?: boolean; resume?: SearchContinuationPort["resume"]; idleMs?: number; totalMs?: number; tickMs?: number; open?: () => Promise<BrowserHandle> } = {}) {
  let clock = Date.now();
  const handle: BrowserHandle = { page: {} as Page, context: {} as BrowserContext, input: vi.fn(async () => undefined), close: vi.fn(async () => undefined), frame: () => ({ sequence: 1, jpeg: "synthetic", width: 1280, height: 800 }) };
  const search: SearchContinuationPort = { prepare: vi.fn(async () => ({ startUrl: "https://www.cian.ru/cat.php", parameters: { city: "test" } })),
    isReady: vi.fn(async () => options.ready ?? true), resume: vi.fn<SearchContinuationPort["resume"]>(options.resume ?? (async () => "completed")), blocked: vi.fn(async () => undefined) };
  const audit = vi.fn<SessionAudit>(async () => undefined); const repo = new MemorySessionRepository();
  const service = new BrowserSessionService(repo, { open: options.open ?? (async () => handle) }, search, audit, { now: () => clock, tickMs: options.tickMs ?? 100_000, idleMs: options.idleMs, totalMs: options.totalMs });
  return { service, search, audit, repo, handle, advance: (ms: number) => { clock += ms; } };
}
describe("HITL session policies", () => {
  it("continues in the same page/context, exactly once, audits without secrets", async () => {
    const t = setup(); const session = await t.service.create(actor, input);
    await t.service.input(actor, session.id, { type: "text", text: "синтетический секрет" });
    expect((await t.service.complete(actor, session.id)).status).toBe("completed");
    await t.service.complete(actor, session.id);
    expect(t.search.resume).toHaveBeenCalledTimes(1); expect(t.search.resume).toHaveBeenCalledWith(expect.objectContaining({ page: t.handle.page, context: t.handle.context, parameters: { city: "test" } }));
    expect(t.handle.close).toHaveBeenCalledTimes(1); expect((await t.service.frame(actor, session.id)).frame).toBeNull();
    expect(JSON.stringify(t.audit.mock.calls)).not.toContain("синтетический секрет");
    expect(t.audit.mock.calls.map(c => c[1])).toEqual(["created", "opened", "completed"]);
  });
  it.each(["realtor", "manager"] as const)("hides every method from another %s", async role => {
    const t = setup(); const s = await t.service.create(actor, input); const other = { ...actor, userId: "other", role };
    for (const operation of [() => t.service.get(other, s.id), () => t.service.frame(other, s.id), () => t.service.input(other, s.id, { type: "key", key: "Enter" }), () => t.service.complete(other, s.id), () => t.service.cancel(other, s.id)]) await expect(operation()).rejects.toMatchObject({ status: 404 });
    await t.service.shutdown();
  });
  it("claims only one session per employee/source under concurrent create", async () => {
    const t = setup(); const results = await Promise.allSettled(Array.from({ length: 8 }, () => t.service.create(actor, input)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); await t.service.shutdown();
  });
  it("permits isolated sessions for separate employees", async () => {
    const t = setup(); const a = await t.service.create(actor, input), b = await t.service.create({ ...actor, userId: "other" }, input);
    expect(a.id).not.toBe(b.id); await t.service.shutdown();
  });
  it("frame polling does not keep an idle session alive", async () => {
    const t = setup({ idleMs: 1000 }); const s = await t.service.create(actor, input);
    t.advance(900); await t.service.frame(actor, s.id); t.advance(101);
    expect((await t.service.get(actor, s.id)).status).toBe("expired"); expect(t.handle.close).toHaveBeenCalled(); expect(t.search.resume).not.toHaveBeenCalled();
  });
  it("absolute deadline cannot be extended with input", async () => {
    const t = setup({ totalMs: 1500, idleMs: 1000 }); const s = await t.service.create(actor, input);
    t.advance(900); await t.service.input(actor, s.id, { type: "key", key: "Tab" }); t.advance(601);
    expect((await t.service.get(actor, s.id)).closeReason).toBe("absolute_timeout");
  });
  it("cancellation closes context and exposes fallback, without resuming", async () => {
    const t = setup(); const s = await t.service.create(actor, input);
    const result = await t.service.cancel(actor, s.id); expect(result.status).toBe("cancelled"); expect(result.manualImportUrl).toBe("/import");
    expect(t.handle.close).toHaveBeenCalledTimes(1); expect(t.search.resume).not.toHaveBeenCalled();
    await expect(t.service.input(actor, s.id, { type: "key", key: "Enter" })).rejects.toMatchObject({ status: 409 });
  });
  it.each(["challenge", "blocked_again", "exception"])("marks source blocked on %s and keeps secrets out of errors", async kind => {
    const t = setup({ ready: kind !== "challenge", resume: async () => { if (kind === "exception") throw new Error("Cookie=secret"); return "blocked"; } });
    const s = await t.service.create(actor, input); const result = await t.service.complete(actor, s.id);
    expect(result.status).toBe("failed"); expect(t.search.blocked).toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("Cookie=secret");
  });
  it("limits input and polling and rejects unbounded or unsafe input", async () => {
    const t = setup(); const s = await t.service.create(actor, input);
    for (let i = 0; i < 20; i++) await t.service.input(actor, s.id, { type: "click", x: 1, y: 1 });
    await expect(t.service.input(actor, s.id, { type: "key", key: "Enter" })).rejects.toMatchObject({ status: 429 });
    for (const event of [{ type: "click", x: 1280, y: 0 }, { type: "key", key: "F12" }, { type: "text", text: "a".repeat(129) }, { type: "text", text: "\n" }, { type: "navigate", url: "file:///etc/passwd" }]) await expect(t.service.input(actor, s.id, event)).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < 5; i++) await t.service.frame(actor, s.id);
    await expect(t.service.frame(actor, s.id)).rejects.toMatchObject({ status: 429 }); await t.service.shutdown();
  });
  it("closes a browser that finishes launching after cancellation", async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const base = setup(); const t = setup({ open: async () => { await gate; return base.handle; } });
    const pending = t.service.create(actor, input); await vi.waitFor(() => expect(t.audit).toHaveBeenCalled());
    const id = t.audit.mock.calls[0]![0].id; await t.service.cancel(actor, id); release();
    expect((await pending).status).toBe("cancelled"); expect(base.handle.close).toHaveBeenCalledTimes(1);
  });
  it("cancellation interrupts a hung continuation, with no second resume", async () => {
    const t = setup({ resume: async () => new Promise<never>(() => undefined) }); const s = await t.service.create(actor, input);
    const completion = t.service.complete(actor, s.id); await vi.waitFor(() => expect(t.search.resume).toHaveBeenCalledTimes(1));
    await t.service.cancel(actor, s.id); expect((await completion).status).toBe("cancelled"); expect(t.handle.close).toHaveBeenCalledTimes(1);
  });
  it("restart closes stale metadata and allows a fresh claim without reusing cookies", async () => {
    const t = setup(); const s = await t.service.create(actor, input);
    const restarted = new BrowserSessionService(t.repo, { open: async () => t.handle }, t.search, t.audit);
    expect((await restarted.get(actor, s.id)).closeReason).toBe("process_lost");
    const fresh = await restarted.create(actor, input); expect(fresh.id).not.toBe(s.id);
    await restarted.shutdown(); await t.service.shutdown();
  });
  it("watchdog expires a hung continuation independently of its promise", async () => {
    const t = setup({ tickMs: 10, totalMs: 1000, resume: async () => new Promise<never>(() => undefined) });
    const s = await t.service.create(actor, input), completion = t.service.complete(actor, s.id);
    await vi.waitFor(() => expect(t.search.resume).toHaveBeenCalled()); t.advance(1001);
    await vi.waitFor(() => expect(t.handle.close).toHaveBeenCalledTimes(1));
    expect((await completion).status).toBe("expired");
  });
  it("does not claim successful completion when profile cleanup fails", async () => {
    const t = setup(); vi.mocked(t.handle.close).mockRejectedValue(new Error("private/profile/path"));
    const s = await t.service.create(actor, input); const result = await t.service.complete(actor, s.id);
    expect(result.status).toBe("failed"); expect(result.closeReason).toBe("cleanup_failed");
    expect(JSON.stringify(result)).not.toContain("private/profile/path");
  });
  it("does not expose preparation errors or unsafe server URLs to the API logger", async () => {
    const t = setup(); vi.mocked(t.search.prepare).mockRejectedValueOnce(new Error("Cookie=secret"));
    await expect(t.service.create(actor, input)).rejects.toMatchObject({ code: "INFRASTRUCTURE_ERROR", message: "Интерактивное продолжение недоступно. Используйте ручной импорт или добавление по ссылке." });
    vi.mocked(t.search.prepare).mockResolvedValueOnce({ startUrl: "https://user:secret@cian.ru/", parameters: {} });
    await expect(t.service.create(actor, input)).rejects.toMatchObject({ code: "INFRASTRUCTURE_ERROR", message: "Адаптер не предоставил безопасный адрес проверки." });
  });
  it("closes Chromium at the security deadline even while the repository is unavailable", async () => {
    const t = setup({ tickMs: 10, totalMs: 1000 }); const s = await t.service.create(actor, input);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const originalGet = t.repo.get.bind(t.repo);
    vi.spyOn(t.repo, "get").mockImplementation(async id => { await gate; return originalGet(id); });
    t.advance(1001);
    try { await vi.waitFor(() => expect(t.handle.close).toHaveBeenCalledTimes(1)); }
    finally { release(); }
    expect((await t.service.get(actor, s.id)).status).toBe("expired");
  });
  it("long-poll does not retransmit the same frame and terminates on disconnect or cancellation", async () => {
    const t = setup(); const s = await t.service.create(actor, input);
    expect((await t.service.frame(actor, s.id, 0)).frame?.sequence).toBe(1);
    const disconnect = new AbortController();
    const pending = t.service.frame(actor, s.id, 1, disconnect.signal);
    disconnect.abort(); expect((await pending).frame).toBeNull();
    const waiting = t.service.frame(actor, s.id, 1);
    await t.service.cancel(actor, s.id); expect((await waiting).frame).toBeNull();
    expect((await t.service.get(actor, s.id)).status).toBe("cancelled");
  });
});
describe("source allowlist", () => {
  it.each(["http://www.cian.ru/", "https://cian.ru.evil.org/", "https://evilcian.ru/", "https://user:password@cian.ru/", "https://cian.ru:8443/", "http://127.0.0.1/", "https://169.254.169.254/", "file:///etc/passwd", "data:text/html,test"])("denies %s", url => expect(allowsRequest("cian", url, "GET", "document", true)).toBe(false));
  it("allows only static GETs on a CDN, no navigation or POST", () => {
    expect(allowsRequest("cian", "https://images.cdn-cian.ru/x.jpg", "GET", "image", false)).toBe(true);
    expect(allowsRequest("cian", "https://images.cdn-cian.ru/", "GET", "document", true)).toBe(false);
    expect(allowsRequest("cian", "https://images.cdn-cian.ru/", "POST", "fetch", false)).toBe(false);
    expect(allowsRequest("cian", "https://www.cian.ru/", "GET", "document", true)).toBe(true);
  });
  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1", "fd00::1"])("still denies allowlisted hostname resolving to %s", async address => {
    expect(allowsRequest("cian", "https://test.cian.ru/", "GET", "document", true)).toBe(true);
    await expect(guardExternalUrl("https://test.cian.ru/", async () => [{ address, family: address.includes(":") ? 6 : 4 }])).rejects.toThrow("UNSAFE_ADDRESS");
  });
});
