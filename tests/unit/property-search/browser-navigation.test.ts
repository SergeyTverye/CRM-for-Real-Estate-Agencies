import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright-core";
import { allowsNavigationRequest, createBrowserNavigation, navigationDefaults, navigationPageState } from "@/modules/property-search/infrastructure/browser-navigation";
import { resilientTransport } from "@/modules/property-search/infrastructure/source-response";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";
import * as ssrf from "@/shared/net/ssrf";
import { chromium } from "playwright-core";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("uses desktop/display defaults without enabling headed Chromium on a server", () => {
  expect(navigationDefaults("desktop", true)).toEqual({ cian: true, yandex: true });
  expect(navigationDefaults("desktop", false)).toEqual({ cian: false, yandex: true });
  expect(navigationDefaults("server", false)).toEqual({ cian: false, yandex: true });
});
it("headless Docker Cian returns actionable status without launching Chromium", async () => {
  vi.stubEnv("container", "docker");
  const launch = vi.spyOn(chromium, "launchPersistentContext");
  const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: true, navigationSources: ["cian"] });
  const result = await adapter.searchDetailed({ operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources: ["cian"] });
  expect(result.sources[0]).toMatchObject({ status: "needs_user_action", reason: expect.stringContaining("нет дисплея"), actionUrl: "https://www.cian.ru/" });
  expect(launch).not.toHaveBeenCalled();
});
it("REPLAY distinguishes Cian Servicepipe, a listing, explicit empty and an unknown page", async () => {
  const html = await readFile("tests/fixtures/scraper/v322/cian-servicepipe-check.html", "utf8");
  expect(navigationPageState("cian", "https://www.cian.ru/cat.php", html)).toBe("needs_user_action");
  expect(navigationPageState("cian", "https://www.cian.ru/cat.php", '<div data-name="OfferCard">Офис</div>')).toBe("results");
  expect(navigationPageState("yandex", "https://realty.yandex.ru/", '<div class="offer-card">Офис</div>')).toBe("results");
  expect(navigationPageState("yandex", "https://realty.yandex.ru/showcaptcha", "<h1>Проверка</h1>")).toBe("needs_user_action");
  expect(navigationPageState("yandex", "https://realty.yandex.ru/", "Объявлений не найдено")).toBe("empty");
  expect(navigationPageState("cian", "https://www.cian.ru/", "<title>Ошибка</title>")).toBe("unknown");
});
it("allows only HTTPS source navigation and source/check assets", () => {
  expect(allowsNavigationRequest("cian", "https://servicepipe.tech/static/checkjs/main.js", false)).toBe(true);
  for (const url of ["http://www.cian.ru", "https://cian.ru.evil.example", "https://127.0.0.1", "https://www.cian.ru:444", "https://user:pass@www.cian.ru", "file:///tmp/a"]) expect(allowsNavigationRequest("cian", url, true)).toBe(false);
  expect(allowsNavigationRequest("cian", "https://servicepipe.tech/", true)).toBe(false);
});

function fakePage(documents: string[]) {
  let current = "about:blank", index = 0;
  const page = {
    url: () => current, content: vi.fn(async () => documents[Math.min(index++, documents.length - 1)]!),
    goto: vi.fn(async (url: string) => { current = url; }), on: vi.fn(), off: vi.fn(),
  };
  const network = { send: vi.fn(async (_method: string, _params?: object) => {}), on: vi.fn((_name: string, _callback: unknown) => {}) };
  const context = { pages: () => [page], newCDPSession: async () => network, close: vi.fn(async () => {}), clearPermissions: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}), on: vi.fn() };
  const open = vi.fn(async (_profile: string, _headed: boolean) => context as unknown as BrowserContext);
  return { page, context, open, network };
}
it("executes JS wait to results; repeated jobs use the same per-source persistent profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navigation-test-"));
  try {
    const fake = fakePage(['<h1>Проверка</h1>', '<div class="offer-card">Офис</div>']);
    for (let i = 0; i < 2; i++) {
      const browser = await createBrowserNavigation({ source: "yandex", deadline: Date.now() + 5000, profileRoot: root, open: fake.open, settleMs: 1000 });
      const response = await resilientTransport(browser.transport, "yandex", Date.now() + 5000)({ url: "https://realty.yandex.ru/", method: "GET", headers: {}, timeout: 4000 });
      expect(response).toMatchObject({ status: 200, data: expect.stringContaining("offer-card") });
      await browser.close();
    }
    expect(fake.open.mock.calls.map(c => c[0])).toEqual([path.join(root, "yandex"), path.join(root, "yandex")]);
    expect(fake.page.goto).toHaveBeenCalledTimes(2);
    expect(fake.context.close).toHaveBeenCalledTimes(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("a remaining challenge becomes NEEDS_USER_ACTION and closes its browser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navigation-test-"));
  try {
    const fake = fakePage(["<h1>Подтвердите, что вы человек</h1>"]);
    const browser = await createBrowserNavigation({ source: "yandex", deadline: Date.now() + 3000, profileRoot: root, open: fake.open, settleMs: 0 });
    await expect(resilientTransport(browser.transport, "yandex", Date.now() + 3000)({ url: "https://realty.yandex.ru/", method: "GET", headers: {}, timeout: 2000 })).rejects.toMatchObject({ code: "NEEDS_USER_ACTION" });
    await browser.close(); expect(fake.context.close).toHaveBeenCalledOnce();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("guards each paused redirect/subrequest without fulfilling HTTP or leaking to a private address", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navigation-test-"));
  try {
    const fake = fakePage(['<div class="offer-card">Офис</div>']);
    const browser = await createBrowserNavigation({ source: "yandex", deadline: Date.now() + 5000, profileRoot: root, open: fake.open });
    const handle = fake.network.on.mock.calls[0]?.[1] as unknown as (event: { requestId: string; resourceType: string; request: { url: string; method: string } }) => Promise<void>;
    const guard = vi.spyOn(ssrf, "guardExternalUrl").mockResolvedValue({ url: new URL("https://realty.yandex.ru/"), addresses: [{ address: "8.8.8.8", family: 4 }] });
    await handle({ requestId: "first", resourceType: "Document", request: { url: "https://realty.yandex.ru/", method: "GET" } });
    expect(fake.network.send).toHaveBeenCalledWith("Fetch.continueRequest", { requestId: "first" });
    await handle({ requestId: "redirect", resourceType: "Document", request: { url: "https://127.0.0.1/", method: "GET" } });
    expect(fake.network.send).toHaveBeenCalledWith("Fetch.failRequest", { requestId: "redirect", errorReason: "BlockedByClient" });
    guard.mockRejectedValueOnce(new Error("UNSAFE_ADDRESS"));
    await handle({ requestId: "dns-private", resourceType: "Script", request: { url: "https://yastatic.net/script.js", method: "GET" } });
    expect(fake.network.send).toHaveBeenCalledWith("Fetch.failRequest", { requestId: "dns-private", errorReason: "BlockedByClient" });
    await browser.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("pagination/details use one page/context and abort closes it without losing the profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navigation-test-"));
  try {
    const fake = fakePage(['<div class="offer-card">Офис</div>']);
    const browser = await createBrowserNavigation({ source: "yandex", deadline: Date.now() + 6000, profileRoot: root, open: fake.open });
    for (const url of ["https://realty.yandex.ru/?page=1", "https://realty.yandex.ru/?page=2", "https://realty.yandex.ru/offer/123/"])
      await browser.transport({ url, method: "GET", headers: {}, timeout: 5000 });
    expect(fake.open).toHaveBeenCalledOnce(); expect(fake.page.goto).toHaveBeenCalledTimes(3);
    const controller = new AbortController(); controller.abort();
    await expect(browser.transport({ url: "https://realty.yandex.ru/", method: "GET", headers: {}, timeout: 1000, signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    await browser.close(); expect(fake.context.close).toHaveBeenCalledOnce();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("adapter selects native browser navigation for Yandex and retains needs_user_action", async () => {
  const factory = vi.fn(async () => ({ close: async () => {}, searchSite: async () => ({ source: "yandex" as const, query: {}, total: 0, timestamp: new Date().toISOString(), results: [], pages: [], partial: false, errors: [{ source: "yandex" as const, page: 1, code: "NEEDS_USER_ACTION", error: "" }] }) }));
  const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: true, navigationSources: ["yandex"], factory });
  const result = await adapter.searchDetailed({ sources: ["yandex"], purposes: ["office"], operation: "rent", priceUnit: "rub_month" });
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ navigationSource: "yandex", browser: { sources: ["yandex"] } }));
  expect(result.sources[0]).toMatchObject({ status: "needs_user_action", failureCode: "NEEDS_USER_ACTION" });
});
