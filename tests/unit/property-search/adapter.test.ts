import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { chromium } from "playwright-core";
import { SOURCES, type Source } from "@/modules/property-search/domain/types";
import { defaultScraperFactory, RealEstateScraperAdapter, ScraperJobLimiter, type ScraperFactory } from "@/modules/property-search/infrastructure/scraper-adapter";
import { guardExternalUrl, isPublicIp, parseExternalUrl, safeRequest } from "@/shared/net/ssrf";
import * as ssrf from "@/shared/net/ssrf";
afterEach(() => vi.restoreAllMocks());

function fixture(source: Source): RealEstateScraper.SearchResult & { source: Source } {
  return JSON.parse(readFileSync(`tests/fixtures/scraper/${source}.json`, "utf8"));
}
function adapter(searchSite: (source: Source) => Promise<ReturnType<typeof fixture>>, extra: ConstructorParameters<typeof RealEstateScraperAdapter>[0] = {}) {
  const close = vi.fn(async () => {});
  const factory: ScraperFactory = vi.fn(async () => ({ searchSite, close }));
  return { instance: new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, factory, ...extra }), factory, close };
}
describe("seven source contract fixtures (synthetic, offline)", () => {
  it("turning native navigation off never silently selects the legacy intercepted browser", async () => {
    const { instance, factory } = adapter(async source => fixture(source), { browserEnabled: true, navigationSources: [] });
    await instance.searchDetailed({ operation: "sale", purposes: ["office"], sources: ["cian", "yandex"] });
    expect(factory).toHaveBeenCalledTimes(2);
    for (const [config] of vi.mocked(factory).mock.calls) {
      expect(config.browser).toBeUndefined(); expect(config.navigationSource).toBeUndefined();
    }
  });
  it("browser subrequests consume the remaining absolute deadline and stop when exhausted", async () => {
    let handle!: (route: { request(): unknown; abort(): Promise<void>; fulfill(input: unknown): Promise<void> }) => Promise<void>;
    const context = { route: vi.fn(async (_pattern: string, callback: typeof handle) => { handle = callback; }), routeWebSocket: vi.fn(async () => {}) };
    const close = vi.fn(async () => {});
    vi.spyOn(chromium, "launch").mockResolvedValue({ newContext: async () => context, close } as never);
    vi.spyOn(RealEstateScraper, "createBrowserTransport").mockReturnValue(async () => ({ data: "", status: 200 }));
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const network = vi.spyOn(ssrf, "safeRequest").mockResolvedValue({ status: 200, headers: {}, data: Buffer.from(""), url: "https://www.cian.ru/" });
    const client = await defaultScraperFactory({ timeout: 30000, jobDeadlineAt: now + 10000, browser: { sources: ["cian"] } });
    const route = { request: () => ({ url: () => "https://www.cian.ru/", method: () => "GET", headers: () => ({}), postData: () => null }), abort: vi.fn(async () => {}), fulfill: vi.fn(async () => {}) };
    clock.mockReturnValue(now + 9500); await handle(route);
    expect(network).toHaveBeenCalledWith("https://www.cian.ru/", expect.objectContaining({ timeoutMs: 500 }));
    clock.mockReturnValue(now + 10001); await handle(route);
    expect(route.abort).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledOnce();
    await client.close();
  });
  it.each(SOURCES)("normalizes %s and re-filters on server", async source => {
    const { instance, close } = adapter(async s => fixture(s));
    const result = await instance.search({ city: "Москва", operation: "sale", sources: [source], areaTo: 99 });
    expect(result.sources[0]).toMatchObject({ source, status: "success", resultCount: 1 });
    expect(result.listings[0]?.evaluation.verdict).toBe("rejected");
    expect(result.listings[0]?.listing).toMatchObject({ source, sourceListingId: "synthetic-101", price: "15000000.00" });
    expect(close).toHaveBeenCalledOnce();
  });
  it("isolates blocked/429, unsupported, errors, partial and correct zero", async () => {
    const { instance } = adapter(async source => {
      const f = fixture(source);
      if (source === "cian") return { ...f, results: [], pages: [], errors: [{ source, page: 1, code: "ACCESS_BLOCKED", error: "captcha", status: 429 }] };
      if (source === "avito") throw { code: "FETCH_FAILED", status: 429 };
      if (source === "domclick") throw { code: "UNSUPPORTED_FILTER" };
      if (source === "yandex") throw new Error("synthetic failure");
      if (source === "youla") return { ...f, partial: true, errors: [{ source, page: 2, code: "FETCH_FAILED", error: "failed page" }] };
      if (source === "onrealt") return { ...f, results: [], total: 0 };
      return f;
    });
    const result = await instance.search({ city: "Москва", operation: "sale" });
    expect(Object.fromEntries(result.sources.map(s => [s.source, s.status]))).toEqual({ cian: "blocked", avito: "blocked", domclick: "unsupported_filter", yandex: "error", youla: "partial", onrealt: "success", mirkvartir: "success" });
    expect(result.sources.find(s => s.source === "onrealt")?.resultCount).toBe(0);
    expect(result.listings).toHaveLength(2);
  });
  it("bounds timeout and closes client", async () => {
    const { instance, close } = adapter(() => new Promise(() => {}), { jobTimeoutMs: 10 });
    expect((await instance.search({ city: "Москва", operation: "sale", sources: ["cian"] })).sources[0]?.status).toBe("timeout");
    expect(close).toHaveBeenCalledOnce();
  });
  it("limits concurrency across simultaneous searches", async () => {
    let running = 0, maximum = 0;
    const { instance } = adapter(async s => { running++; maximum = Math.max(maximum, running); await new Promise(resolve => setTimeout(resolve, 5)); running--; return fixture(s); }, { limiter: new ScraperJobLimiter(1) });
    await Promise.all([instance.search({ city: "Москва", operation: "sale", sources: ["cian", "youla"] }), instance.search({ city: "Москва", operation: "sale", sources: ["onrealt"] })]);
    expect(maximum).toBe(1);
  });
  it("uses one deadline including queue time, retains earlier results, and recovers on the next job", async () => {
    let hanging = true;
    const calls: Source[] = [];
    const { instance, close } = adapter(async source => {
      calls.push(source);
      if (hanging && source === "youla") return new Promise(() => {});
      return fixture(source);
    }, { jobTimeoutMs: 40, limiter: new ScraperJobLimiter(1) });
    const result = await instance.search({ city: "Москва", operation: "sale", sources: ["cian", "youla", "onrealt"] });
    expect(result.sources.map(s => s.status)).toEqual(["success", "timeout", "timeout"]);
    expect(result.listings).toHaveLength(1);
    expect(calls).toEqual(["cian", "youla"]);
    expect(close).toHaveBeenCalledTimes(2);
    hanging = false;
    const recovered = await instance.search({ city: "Москва", operation: "sale", sources: ["onrealt"] });
    expect(recovered.sources[0]?.status).toBe("success");
    expect(recovered.listings).toHaveLength(1);
  });
  it("does not silently search Moscow when an unknown city lacks location ids", async () => {
    const { instance, factory } = adapter(async s => fixture(s));
    const result = await instance.search({ city: "Неизвестный город", operation: "sale", sources: ["domclick", "avito", "mirkvartir"] });
    expect(result.sources.every(s => s.status === "unsupported_filter")).toBe(true); expect(factory).not.toHaveBeenCalled();
    expect(result.sources.map(s => s.reason)).toEqual([
      "Фильтр city: требуется sourceOptions.domclick.address",
      "Фильтр city: требуется sourceOptions.avito.locationId",
      "Фильтр city: требуется sourceOptions.mirkvartir.locationIds",
    ]);
  });
  it("passes Novosibirsk geography to the factory client", async () => {
    const searchSite = vi.fn(async (source: Source) => fixture(source));
    const { instance } = adapter(searchSite);
    const result = await instance.search({ operation: "sale", purposes: ["office"], sources: ["domclick", "avito", "mirkvartir"] });
    expect(result.sources.every(s => s.status === "success")).toBe(true);
    expect(searchSite).toHaveBeenCalledWith("avito", expect.objectContaining({ sourceOptions: { avito: { citySlug: "novosibirsk", locationId: 641780 } } }));
  });
  it("does not call a failed first page partial or expose upstream payloads", async () => {
    const { instance } = adapter(async source => ({ ...fixture(source), results: [], pages: [], errors: [{ source, page: 1, code: "PARSE_FAILED", error: "private seller payload" }] }));
    expect((await instance.search({ operation: "sale", sources: ["cian"] })).sources[0]).toMatchObject({ status: "error", resultCount: 0, reason: "cian: PARSE_FAILED" });
  });
  it("disabled does not launch browser", async () => {
    const { instance, factory } = adapter(async s => fixture(s), { enabled: false });
    expect((await instance.search({ operation: "sale" })).sources.every(s => s.status === "disabled")).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });
  it("package export create accepts browser option and needs explicit close", () => {
    expect(typeof RealEstateScraper.create).toBe("function");
    expect(typeof RealEstateScraper.prototype.close).toBe("function");
  });
  it("package parses saved CAPTCHA without network", () => {
    const scraper = new RealEstateScraper();
    const html = readFileSync("tests/fixtures/scraper/blocked.html", "utf8");
    expect(() => scraper.parsers.onrealt.parsePage(html, "https://onrealt.ru/", {})).toThrow();
  });
  it("package recognizes explicit OnRealt empty page", () => {
    const scraper = new RealEstateScraper();
    const html = readFileSync("tests/fixtures/scraper/onrealt-empty.html", "utf8");
    expect(scraper.parsers.onrealt.parsePage(html, "https://onrealt.ru/", {})).toMatchObject({ results: [], hasNext: false, sourceTotal: 0 });
  });
  it("production factory closes original context, guards new browser context and owns lifecycle", async () => {
    const context = { route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}) };
    const originalClose = vi.fn(async () => {}), close = vi.fn(async () => {});
    const newContext = vi.fn(async () => context);
    const launched = { context: { close: originalClose }, browser: { newContext }, close } as unknown as Awaited<ReturnType<typeof RealEstateScraper.launchBrowserTransport>>;
    vi.spyOn(chromium, "launch").mockResolvedValue({ ...launched.browser, close } as never);
    vi.spyOn(RealEstateScraper, "createBrowserTransport").mockReturnValue(async () => ({ data: "", status: 200 }));
    const client = await defaultScraperFactory({ browser: { channel: "chrome", sources: ["cian"] } });
    expect(originalClose).not.toHaveBeenCalled();
    expect(newContext).toHaveBeenCalledWith({ serviceWorkers: "block", locale: "ru-RU" });
    expect(context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(context.routeWebSocket).toHaveBeenCalledWith("**/*", expect.any(Function));
    await client.close(); expect(close).toHaveBeenCalledOnce();
  });
  it("closes browser if guarded context setup fails", async () => {
    const close = vi.fn(async () => {});
    vi.spyOn(chromium, "launch").mockResolvedValue({ newContext: async () => { throw new Error("setup failed"); }, close } as never);
    await expect(defaultScraperFactory({ browser: true })).rejects.toThrow("setup failed");
    expect(close).toHaveBeenCalledOnce();
  });
});
describe("SSRF guard", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.4.2", "192.168.1.1", "169.254.169.254", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "0.0.0.0", "ff02::1"])("blocks %s", ip => expect(isPublicIp(ip)).toBe(false));
  it.each(["file:///etc/passwd", "javascript:alert(1)", "http://user:password@example.com"])("blocks unsafe scheme/credentials %s", url => expect(() => parseExternalUrl(url)).toThrow());
  it("checks all resolved addresses and accepts public addresses", async () => {
    await expect(guardExternalUrl("https://example.com", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }])).rejects.toThrow("UNSAFE_ADDRESS");
    await expect(guardExternalUrl("https://example.com/image.jpg", async () => [{ address: "8.8.8.8", family: 4 }])).resolves.toHaveProperty("addresses");
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
  });
  it("bounds even hung DNS without outbound request", async () => {
    await expect(safeRequest("https://example.com", { timeoutMs: 5, resolve: () => new Promise(() => {}) })).rejects.toThrow("NETWORK_TIMEOUT_OR_ABORT");
  });
});
