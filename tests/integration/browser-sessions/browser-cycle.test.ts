import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright-core";
import { access, readdir } from "node:fs/promises";
import os from "node:os";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { MemorySessionRepository } from "@/modules/browser-sessions/infrastructure/memory-repository";
import { PlaywrightSessionBrowser } from "@/modules/browser-sessions/infrastructure/playwright-browser";
import type { BrowserHandle, SearchContinuationPort } from "@/modules/browser-sessions/domain/session";
import type { Actor } from "@/modules/auth/domain/actor";
import { captchaStand } from "../../fixtures/captcha-stand/server";
import { viewerHarness } from "../../fixtures/captcha-stand/harness";

const actor: Actor = { userId: "10000000-0000-4000-8000-000000000001", sessionId: "fixture", displayName: "Сотрудник стенда", role: "realtor", login: "fixture", mustChangePassword: false };
const job = { searchRunId: "20000000-0000-4000-8000-000000000001", source: "cian" as const };
const executablePath = process.env.SCRAPER_CHROME_PATH || chromium.executablePath();
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function scenario(options: { tickMs?: number; idleMs?: number; totalMs?: number } = {}) {
  const stand = await captchaStand(); cleanup.push(stand.close);
  // The adapter owns detection; the browser-session module receives a needs_user_action job.
  const probe = await stand.network.transport(`${stand.origin}/check`);
  const adapterStatus = probe.data.includes("data-needs-user-action") ? "needs_user_action" : "success";
  let handle: BrowserHandle | undefined;
  const transport = vi.fn(stand.network.transport);
  const factory = new PlaywrightSessionBrowser({ executablePath, network: { ...stand.network, transport } });
  const snapshots: { id: string; area: number; price: string }[] = []; const blocked = vi.fn(async () => undefined);
  const search: SearchContinuationPort = {
    prepare: async () => { if (adapterStatus !== "needs_user_action") throw new Error("SOURCE_NOT_WAITING_FOR_HUMAN"); return { startUrl: `${stand.origin}/check`, parameters: { purpose: "office" } }; },
    isReady: async page => await page.locator("[data-listing]").count() > 0,
    resume: vi.fn<SearchContinuationPort["resume"]>(async ({ page, context, signal, parameters }) => {
      expect(page).toBe(handle?.page); expect(context).toBe(handle?.context); expect(parameters).toEqual({ purpose: "office" });
      // Revalidation occurs in the trusted continuation, immediately before persistence.
      const data = await page.locator("[data-listing]").evaluateAll(rows => rows.map(row => ({ id: row.getAttribute("data-listing")!, area: Number(row.getAttribute("data-area")), price: row.getAttribute("data-price")! })));
      for (const row of data) { if (!row.id || row.area <= 0 || !/^\d+$/u.test(row.price)) throw new Error("INVALID_CANDIDATE"); }
      signal.throwIfAborted(); snapshots.push(...data); return "completed";
    }), blocked,
  };
  const repo = new MemorySessionRepository(); const audit = vi.fn(async () => undefined);
  const service = new BrowserSessionService(repo, { open: async (...args) => { handle = await factory.open(...args); return handle; } }, search, audit, { tickMs: options.tickMs ?? 100_000, idleMs: options.idleMs ?? 60_000, totalMs: options.totalMs });
  cleanup.push(() => service.shutdown());
  const session = await service.create(actor, job);
  return { stand, transport, adapterStatus, service, session, search, snapshots, handle: handle!, currentHandle: () => handle!, repo, audit, blocked };
}
describe("AT-05 controlled Chromium cycle", () => {
  it("detect → frame → human input FROM React viewer → continuation → validated results → profile cleanup", async () => {
    await access(executablePath);
    const profilesBefore = new Set((await readdir(os.tmpdir())).filter(n => n.startsWith("crm-browser-session-")));
    const t = await scenario();
    expect(t.adapterStatus).toBe("needs_user_action");
    expect(await t.handle.page.locator("[data-needs-user-action]").count()).toBe(1);
    expect(t.session.status).toBe("active");
    const harness = await viewerHarness(t.service, actor); cleanup.push(harness.close);
    const browser = await chromium.launch({ executablePath, headless: true }); cleanup.push(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
    await page.goto(`${harness.origin}/?id=${t.session.id}`);
    const screen = page.getByRole("application", { name: "Экран площадки" });
    await vi.waitFor(async () => expect(await page.getByRole("button", { name: "Готово", exact: true }).isEnabled()).toBe(true), { timeout: 10_000 });
    await screen.click({ position: { x: 200, y: 185 } });
    await page.getByLabel("Текст для площадки", { exact: true }).fill("человек");
    await page.getByRole("button", { name: "Передать текст", exact: true }).click();
    await vi.waitFor(async () => expect(await t.handle.page.locator("input[name=proof]").inputValue()).toBe("человек"), { timeout: 5000 });
    await screen.click({ position: { x: 200, y: 255 } });
    await vi.waitFor(async () => expect(await t.handle.page.locator("[data-listing]").count()).toBe(1), { timeout: 5000 });
    // Completion includes real Chromium shutdown/profile removal, not just a React render.
    // Await its actual response before starting the unchanged UI-feedback budget.
    const [completion] = await Promise.all([
      page.waitForResponse(response => response.url() === `${harness.origin}/api/v1/browser-sessions/${t.session.id}/complete` && response.request().method() === "POST"),
      page.getByRole("button", { name: "Готово", exact: true }).click(),
    ]);
    expect(completion.status()).toBe(200);
    expect(await completion.json()).toMatchObject({ status: "completed", closeReason: "search_resumed" });
    await vi.waitFor(async () => expect(await page.getByRole("status").innerText()).toContain("Поиск продолжен"), { timeout: 10_000 });
    expect(t.snapshots).toEqual([{ id: "synthetic-1", area: 100, price: "5000000" }]);
    expect(t.search.resume).toHaveBeenCalledTimes(1); expect(t.handle.page.isClosed()).toBe(true);
    expect((await t.service.frame(actor, t.session.id)).frame).toBeNull();
    expect(JSON.stringify(t.audit.mock.calls)).not.toContain("stand_verified");
    const profilesAfter = (await readdir(os.tmpdir())).filter(n => n.startsWith("crm-browser-session-") && !profilesBefore.has(n));
    expect(profilesAfter).toEqual([]);
  });
  it("automatically continues only after positive detection", async () => {
    const t = await scenario({ tickMs: 100 });
    await t.service.input(actor, t.session.id, { type: "click", x: 200, y: 185 });
    await t.service.input(actor, t.session.id, { type: "text", text: "человек" });
    await t.service.input(actor, t.session.id, { type: "click", x: 200, y: 255 });
    await vi.waitFor(async () => expect((await t.service.get(actor, t.session.id)).status).toBe("completed"), { timeout: 10_000 });
    expect(t.snapshots).toHaveLength(1); expect(t.handle.page.isClosed()).toBe(true);
  });
  it("cancels and isolates independent contexts and cookies", async () => {
    const t = await scenario();
    const another = { ...actor, userId: "10000000-0000-4000-8000-000000000002" };
    await expect(t.service.frame(another, t.session.id)).rejects.toMatchObject({ status: 404 });
    await t.service.input(actor, t.session.id, { type: "click", x: 200, y: 185 });
    await t.service.input(actor, t.session.id, { type: "text", text: "человек" });
    await t.service.input(actor, t.session.id, { type: "click", x: 200, y: 255 });
    await vi.waitFor(async () => expect(await t.handle.page.locator("[data-listing]").count()).toBe(1));
    await t.service.cancel(actor, t.session.id);
    const s = await t.service.create(another, job); const rt = await t.service.frame(another, s.id);
    expect(rt.status).toBe("active"); expect(t.snapshots).toEqual([]);
    expect(await t.currentHandle().page.locator("[data-needs-user-action]").count()).toBe(1);
    expect(await t.currentHandle().page.locator("[data-listing]").count()).toBe(0);
    await t.service.cancel(another, s.id); expect(t.handle.page.isClosed()).toBe(true);
  });
  it("denies cross-domain navigation before any external request", async () => {
    const t = await scenario(); let externalRequests = 0;
    const requestsBefore = t.stand.requests();
    t.handle.context.on("request", request => { if (new URL(request.url()).hostname === "example.org") externalRequests++; });
    await t.service.input(actor, t.session.id, { type: "click", x: 150, y: 410 });
    // get() awaits durable closure, including real Chromium shutdown and profile removal.
    // Vitest's default 1s wait is shorter than that cleanup on portable Windows Chromium.
    await vi.waitFor(async () => expect((await t.service.get(actor, t.session.id)).status).toBe("failed"), { timeout: 10_000 });
    expect(t.blocked).toHaveBeenCalledWith(job.searchRunId, "cian", "navigation_blocked");
    expect((await t.service.get(actor, t.session.id)).closeReason).toBe("navigation_blocked");
    expect(t.transport.mock.calls.every(([raw]) => new URL(raw).origin === t.stand.origin)).toBe(true);
    expect(t.stand.requests()).toBe(requestsBefore);
    expect(t.snapshots).toEqual([]);
    // Chromium can emit a request event for an aborted route; fixture transport rejects every foreign origin.
    expect(externalRequests).toBeLessThanOrEqual(1); expect(t.handle.page.isClosed()).toBe(true);
  });
  it("never lets Chromium follow an HTTP redirect outside the guarded transport", async () => {
    const t = await scenario();
    const requestsBefore = t.stand.requests();
    await t.handle.page.goto(`${t.stand.origin}/redirect-forbidden`).catch(() => undefined);
    await vi.waitFor(async () => expect((await t.service.get(actor, t.session.id)).status).toBe("failed"), { timeout: 10_000 });
    expect(t.blocked).toHaveBeenCalledWith(job.searchRunId, "cian", "navigation_blocked");
    expect((await t.service.get(actor, t.session.id)).closeReason).toBe("navigation_blocked");
    expect(t.transport.mock.calls.every(([raw, options]) => new URL(raw).origin === t.stand.origin && options?.followRedirects === false)).toBe(true);
    expect(t.transport.mock.calls.filter(([raw]) => new URL(raw).pathname === "/redirect-forbidden")).toHaveLength(1);
    expect(t.stand.requests()).toBe(requestsBefore + 1);
    expect(t.snapshots).toEqual([]);
    expect(t.handle.page.isClosed()).toBe(true);
  });
  it("idle timer actually closes Chromium without any request from CRM", async () => {
    const t = await scenario({ idleMs: 2500, tickMs: 100 });
    await vi.waitFor(() => expect(t.handle.page.isClosed()).toBe(true), { timeout: 5000 });
    expect((await t.service.get(actor, t.session.id)).status).toBe("expired"); expect(t.snapshots).toEqual([]);
  });
});
