import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { NextRequest } from "next/server";
import RealEstateScraper from "real-estate-scrapper";
import { db } from "@/shared/db/client";
import type { BrowserHandle } from "@/modules/browser-sessions/domain/session";
import type { Actor } from "@/modules/auth/domain/actor";
import { createSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { PrismaSessionRepository } from "@/modules/browser-sessions/infrastructure/prisma-repository";
import { PlaywrightSessionBrowser } from "@/modules/browser-sessions/infrastructure/playwright-browser";
import { configureBrowserSessionService } from "@/modules/browser-sessions/application/dependencies";
import { attachInteractiveSearchAdapter } from "@/modules/property-search/application/browser-continuation";
import { ProductionInteractiveSearchAdapter } from "@/modules/property-search/infrastructure/interactive-search-adapter";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { enqueueSearch, processSearchQueue } from "@/modules/property-search/application/search-queue";
import { POST as start } from "@/app/api/v1/browser-sessions/route";
import { GET as frame } from "@/app/api/v1/browser-sessions/[id]/frame/route";
import { POST as input } from "@/app/api/v1/browser-sessions/[id]/input/route";
import { POST as complete } from "@/app/api/v1/browser-sessions/[id]/complete/route";
import { POST as cancelSession } from "@/app/api/v1/browser-sessions/[id]/cancel/route";
import { GET as metadata } from "@/app/api/v1/browser-sessions/[id]/route";
import { POST as cancel } from "@/app/api/v1/property-search/runs/[id]/cancel/route";
import { GET as progress } from "@/app/api/v1/property-search/runs/[id]/progress/route";
import { GET as results } from "@/app/api/v1/property-search/runs/[id]/results/route";
import { captchaStand } from "./server";

export async function productionCycle(mode: "success" | "expired" | "cancelled" | "blocked" | "foreign" | "restart" = "success") {
  let profile = "";
  const stand = await captchaStand({ cian: true, blockNextPage: mode === "blocked" });
  const virtual = "https://www.cian.ru";
  // Only the test transport is replaced. Production source policy, parser and URL builder stay intact.
  const network = { allows: (_source: unknown, raw: string) => new URL(raw).origin === virtual,
    transport: async (raw: string, options = {}) => {
      assert.equal(new URL(raw).origin, virtual);
      const response = await stand.network.transport(`${stand.origin}${new URL(raw).pathname}${new URL(raw).search}`, options);
      return { ...response, url: raw };
    } };
  const user = await db.user.create({ data: { login: `hitl-${randomUUID()}`, displayName: "DEMO сотрудник HITL", roleCode: "realtor", mustChangePassword: false, passwordHash: "synthetic-disabled-login" } });
  const actor: Actor = { userId: user.id, role: "realtor", login: user.login, displayName: user.displayName, mustChangePassword: false, sessionId: "synthetic" };
  const auth = await createSession(db, actor.userId, { ip: "127.0.0.1", userAgent: "hitl-test" });
  const cookie = `${SESSION_COOKIE}=${auth.token}`;
  const origin = "http://crm.test";
  function request(method: string, url: string, body?: unknown, credential = cookie) {
    return new NextRequest(`${origin}${url}`, { method, headers: { host: "crm.test", origin, cookie: credential, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const filters = SearchFilters.parse({ city: "Новосибирск", operation: "sale", purposes: ["office"], sources: ["cian"] });
  const adapter = new ProductionInteractiveSearchAdapter(() => ["cian"]);
  const port = attachInteractiveSearchAdapter(adapter);
  let clock = Date.now();
  const auditEvents: string[] = [];
  const browser = new PlaywrightSessionBrowser({ executablePath: process.env.SCRAPER_CHROME_PATH, network, profileCreated: value => { profile = value; } });
  let handle: BrowserHandle | undefined;
  const service = new BrowserSessionService(new PrismaSessionRepository(), { open: async (...args) => { handle = await browser.open(...args); return handle; } }, port, async (_session, event) => { auditEvents.push(event); }, { now: () => clock, tickMs: 100_000, maxConcurrent: 1 });
  configureBrowserSessionService(service);
  try {
    const run = await enqueueSearch(actor, { filters, sources: ["cian"], idempotencyKey: randomUUID(), depth: { maxPages: 2, limit: 5 } });
    const scraper = new RealEstateScraperAdapter({ enabled: true, enabledSources: ["cian"], browserEnabled: false, factory: async config => extendSourceParsers(new RealEstateScraper({ ...config, transport: async req => {
      const response = await network.transport(req.url, { method: req.method as "GET" | "POST", headers: req.headers, signal: req.signal });
      return { data: response.data.toString("utf8"), status: response.status, url: response.url, headers: {} };
    } })) });
    assert.equal(await processSearchQueue({ scraper }), true);
    assert.equal((await db.searchRun.findUniqueOrThrow({ where: { id: run.id } })).status, "needs_user_action");
    const prepared = await port.prepare(actor, run.id, "cian");
    assert.match(prepared.startUrl, /\/cat\.php\?/u); assert.match(prepared.startUrl, /region=4897/u);
    const created = await start(request("POST", "/api/v1/browser-sessions", { searchRunId: run.id, source: "cian" }), { params: Promise.resolve({}) });
    assert.equal(created.status, 200, `start: ${JSON.stringify(await created.clone().json())}`);
    const session = await created.json() as { id: string; status: string };
    assert.equal(session.status, "active");
    const ctx = { params: Promise.resolve({ id: session.id }) };
    const base = `/api/v1/browser-sessions/${session.id}`;
    let image = null;
    for (let i = 0; i < 20 && !image; i++) {
      const response = await frame(request("GET", `${base}/frame`), ctx);
      assert.equal(response.status, 200); image = (await response.json()).frame;
      if (!image) await new Promise(r => setTimeout(r, 220));
    }
    assert.ok(image?.jpeg); assert.equal(image.width, 1280);
    const p = await progress(request("GET", `/api/v1/property-search/runs/${run.id}/progress`), { params: Promise.resolve({ id: run.id }) });
    assert.equal((await p.json()).sources[0].browserSession.id, session.id);
    if (mode === "foreign") {
      const other = await db.user.create({ data: { login: `hitl-other-${randomUUID()}`, displayName: "DEMO чужой", roleCode: "manager", mustChangePassword: false, passwordHash: "disabled" } });
      const otherAuth = await createSession(db, other.id, {});
      const otherCookie = `${SESSION_COOKIE}=${otherAuth.token}`;
      for (const [route, method, suffix, body] of [[metadata, "GET", "", undefined], [frame, "GET", "/frame", undefined], [input, "POST", "/input", { type: "text", text: "человек" }], [complete, "POST", "/complete", undefined], [cancelSession, "POST", "/cancel", undefined]] as const) {
        assert.equal((await route(request(method, `${base}${suffix}`, body, otherCookie), ctx)).status, 404);
      }
      await db.userSession.deleteMany({ where: { userId: other.id } });
      await service.cancel(actor, session.id);
    } else if (mode === "expired") {
      clock += 20 * 60_000 + 1;
      assert.equal((await service.get(actor, session.id)).status, "expired");
      assert.equal((await db.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: "cian" } } })).status, "blocked");
    } else if (mode === "cancelled") {
      assert.equal((await cancel(request("POST", `/api/v1/property-search/runs/${run.id}/cancel`), { params: Promise.resolve({ id: run.id }) })).status, 200);
      assert.equal((await service.get(actor, session.id)).status, "cancelled");
      assert.equal((await db.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: "cian" } } })).status, "cancelled");
    } else if (mode === "restart") {
      await service.shutdown();
      assert.equal((await service.get(actor, session.id)).status, "failed");
      assert.equal((await db.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: "cian" } } })).status, "blocked");
    } else {
      for (const event of [{ type: "click", x: 200, y: 185 }, { type: "text", text: "человек" }, { type: "click", x: 200, y: 255 }]) {
        assert.equal((await input(request("POST", `${base}/input`, event), ctx)).status, 200);
        if (event.type === "text") assert.equal(await handle!.page.locator("input[name=proof]").inputValue(), "человек");
      }
      // Observe completion of the navigation initiated only by human-input API events.
      assert.ok(handle);
      try { await handle.page.getByRole("heading", { name: "DEMO: выдача офисов" }).waitFor(); } catch { assert.fail(JSON.stringify({ ...stand.stats(), session: (await service.get(actor, session.id)).closeReason })); }
      assert.equal(await adapter.isReady(handle.page, "cian"), true);
      const continued = await complete(request("POST", `${base}/complete`), ctx);
      assert.equal(continued.status, 200); const ended = await continued.json();
      assert.equal(ended.status, mode === "blocked" ? "failed" : "completed");
      assert.equal(ended.closeReason, mode === "blocked" ? "blocked_again" : "search_resumed");
      const snapshot = await db.externalListingSnapshot.findMany({ where: { searchRunId: run.id } });
      assert.equal(snapshot.length, 1);
      const persisted = await db.searchRunResult.findMany({ where: { runId: run.id }, include: { listing: true } });
      assert.equal(persisted.length, 1); assert.equal(persisted[0]!.listing.source, "cian");
      const page = await results(request("GET", `/api/v1/property-search/runs/${run.id}/results`), { params: Promise.resolve({ id: run.id }) });
      assert.equal(page.status, 200); assert.equal((await page.json()).total, 1);
      assert.equal((await db.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: "cian" } } })).status, mode === "blocked" ? "blocked" : "completed");
      await service.complete(actor, session.id); assert.equal(await db.externalListingSnapshot.count({ where: { searchRunId: run.id } }), 1);
    }
    assert.equal((await service.frame(actor, session.id)).frame, null);
    assert.ok(profile);
    await assert.rejects(access(profile), { code: "ENOENT" });
    assert.ok(auditEvents.includes("opened"));
    return { mode, status: "PASS", requests: stand.requests(), profilesRemoved: true, sameRun: true, framesViaApi: true };
  } finally {
    await service.shutdown(); await stand.close();
    await db.userSession.deleteMany({ where: { userId: actor.userId } });
  }
}
