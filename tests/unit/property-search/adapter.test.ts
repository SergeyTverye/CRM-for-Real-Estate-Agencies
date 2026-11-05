import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { SOURCES, type Source } from "@/modules/property-search/domain/types";
import { defaultScraperFactory, RealEstateScraperAdapter, ScraperJobLimiter, type ScraperFactory } from "@/modules/property-search/infrastructure/scraper-adapter";
import { guardExternalUrl, isPublicIp, parseExternalUrl, safeRequest } from "@/shared/net/ssrf";
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
  it("does not silently search Moscow when Novosibirsk lacks location ids", async () => {
    const { instance, factory } = adapter(async s => fixture(s));
    const result = await instance.search({ operation: "sale", sources: ["domclick", "avito", "mirkvartir"] });
    expect(result.sources.every(s => s.status === "unsupported_filter")).toBe(true); expect(factory).not.toHaveBeenCalled();
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
    vi.spyOn(RealEstateScraper, "launchBrowserTransport").mockResolvedValue(launched);
    vi.spyOn(RealEstateScraper, "createBrowserTransport").mockReturnValue(async () => ({ data: "", status: 200 }));
    const client = await defaultScraperFactory({ browser: { channel: "chrome", sources: ["cian"] } });
    expect(originalClose).toHaveBeenCalledOnce();
    expect(newContext).toHaveBeenCalledWith({ serviceWorkers: "block", locale: "ru-RU" });
    expect(context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(context.routeWebSocket).toHaveBeenCalledWith("**/*", expect.any(Function));
    await client.close(); expect(close).toHaveBeenCalledOnce();
  });
  it("closes browser if guarded context setup fails", async () => {
    const close = vi.fn(async () => {});
    vi.spyOn(RealEstateScraper, "launchBrowserTransport").mockResolvedValue({ context: { close: async () => {} }, browser: { newContext: async () => { throw new Error("setup failed"); } }, close } as unknown as Awaited<ReturnType<typeof RealEstateScraper.launchBrowserTransport>>);
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
