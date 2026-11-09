import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import RealEstateScraper from "real-estate-scrapper";
import { DateEnrichment } from "@/modules/property-search/infrastructure/date-enrichment";
import { extractListingDates } from "@/modules/property-search/infrastructure/listing-dates";
import { dateEnrichmentProgress, extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { resilientTransport } from "@/modules/property-search/infrastructure/source-response";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { manualListing } from "@/modules/property-search/infrastructure/manual-listing";
import { importOfficialFeed } from "@/modules/property-search/infrastructure/official-feed";
import { SearchFilters, type Source, type NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";

const dir = "tests/fixtures/scraper/p0a-final";
const read = (file: string) => readFileSync(file, "utf8");
const at = "2026-11-06T01:30:00Z";
const identity = { id: "369638218", url: "https://cre.mirkvartir.ru/369638218/" };
describe("P0-A final LIVE date evidence", () => {
  it("rejects the real residential Pascal listing from the frozen LIVE corpus", () => {
    const corpus = JSON.parse(read("tests/fixtures/search-quality/live-2026-11-05.json")) as { listings: { input: NormalizedListing; provenance: { sourceMode: string } }[] };
    const row = corpus.listings.find(r => r.input.sourceListingId === "3936023035793471937")!;
    expect(row.provenance.sourceMode).toBe("LIVE");
    expect(evaluateListing(row.input, SearchFilters.parse({ operation: "sale", purposes: ["office"] })).verdict).toBe("rejected");
  });
  it.each([1, 2])("MIR detail %i distinguishes placement and update and refuses another URL", index => {
    const id = index === 1 ? "369638218" : "369638217", html = read(`${dir}/mirkvartir-${index}.html`);
    expect(extractListingDates("mirkvartir", html, { id, url: `https://cre.mirkvartir.ru/${id}/` }, at)).toMatchObject({ publishedAt: "2026-09-08T17:00:00.000Z", sourceUpdatedAt: "2026-09-08T17:00:00.000Z", datePrecision: "day", dateSource: "mirkvartir:html_label:publication" });
    expect(extractListingDates("mirkvartir", html, { id: "999", url: "https://cre.mirkvartir.ru/999/" }, at).publishedAt).toBeNull();
  });
  it.each([
    ["onrealt", "86528976", "https://onrealt.ru/novosibirsk/kypit-ofis/86528976", "onrealt-1.html", "2026-08-18T01:55:00.000Z"],
    ["onrealt", "86528761", "https://onrealt.ru/novosibirsk/kypit-ofis/86528761", "onrealt-2.html", "2026-08-17T07:26:00.000Z"],
    ["yandex", "3961425542481186113", "https://realty.yandex.ru/offer/3961425542481186113/", "yandex-1.html", "2024-07-22T06:45:01.000Z"],
  ] as const)("retains a source-bound date in %s/%s", (source, id, url, file, publishedAt) => {
    expect(extractListingDates(source, read(`${dir}/${file}`), { id, url }, at).publishedAt).toBe(publishedAt);
  });
  it("does not treat recommendations or an update alone as publication", () => {
    const html = `<link rel="canonical" href="${identity.url}"><section><h4>Информация об объявлении</h4><p>Обновлено: 5 ноября 2026 г.</p></section><article><time datetime="2026-11-06T00:00:00Z">Сегодня</time></article>`;
    expect(extractListingDates("mirkvartir", html, identity, at)).toMatchObject({ publishedAt: null, sourceUpdatedAt: "2026-11-04T17:00:00.000Z" });
  });
  it("measures only a card present in the 25-row live SERP, without extrapolation", () => {
    const report = JSON.parse(read("docs/vkr/p0a-final-dates.json"));
    expect(report.physicalRequests).toBe(6);
    expect(report.mirkvartirSerp).toMatchObject({ total: 25, publicationUnknownBefore: 25, publicationUnknownAfter: 24, cardIdsInSerp: 1 });
  });
  it("bounds details across pages and reports counters", async () => {
    const client = new RealEstateScraper(), parser = client.parsers.mirkvartir;
    const fixture = JSON.parse(read("tests/fixtures/scraper/mirkvartir.json"));
    parser.searchPage = vi.fn(async () => ({ ...fixture.pages[0], results: Array.from({ length: 6 }, (_, n) => ({ ...fixture.results[0], id: String(n), url: `https://cre.mirkvartir.ru/${n}/` })) }));
    const fetch = vi.fn(async (url: string) => `<link rel="canonical" href="${url}"><section><h4>Информация об объявлении</h4><p>Размещено: 9 сентября 2026 г.</p></section>`);
    parser.fetch = fetch;
    extendSourceParsers(client, { maxCards: 2, cache: new Map() });
    expect((await parser.searchPage({})).results).toHaveLength(6);
    await parser.searchPage({});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(dateEnrichmentProgress(client, "mirkvartir")).toMatchObject({ requested: 2, enriched: 2, cacheHits: 2, failed: 0, limit: 2 });
    await client.close();
  });
  it("shares date-only cache across jobs and caches unknown briefly", async () => {
    let now = Date.parse(at); const cache = new Map(), fetch = vi.fn(async () => `<link rel="canonical" href="${identity.url}"><section><h4>Информация об объявлении</h4><p>Обновлено: 5 ноября 2026 г.</p></section>`);
    const options = { cache, now: () => now };
    const first = new DateEnrichment(options);
    expect((await first.read("mirkvartir", identity, fetch))?.publishedAt).toBeNull();
    const second = new DateEnrichment(options);
    await second.read("mirkvartir", identity, fetch); expect(fetch).toHaveBeenCalledOnce(); expect(second.progress.cacheHits).toBe(1);
    now += 300001;
    await new DateEnrichment(options).read("mirkvartir", identity, fetch); expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([...cache.values()])).not.toContain("<section>");
  });
  it("leaves publication time when an optional detail deadline is imminent", async () => {
    const service = new DateEnrichment({ deadline: Date.now() + 15, cache: new Map() });
    const fetch = vi.fn(() => new Promise(() => undefined));
    expect(await service.read("mirkvartir", identity, fetch)).toBeNull();
    await service.read("mirkvartir", identity, fetch); expect(fetch).not.toHaveBeenCalled();
    expect(service.progress.failed).toBe(0);
  });
  it("stops source detail work after one HTTP block; does not retry on next page", async () => {
    const service = new DateEnrichment({ cache: new Map() }), fetch = vi.fn(async () => ({ status: 403, data: "" }));
    await service.read("mirkvartir", identity, fetch);
    await service.read("mirkvartir", { id: "other", url: "https://cre.mirkvartir.ru/other/" }, fetch);
    expect(fetch).toHaveBeenCalledOnce(); expect(service.progress).toMatchObject({ requested: 1, failed: 1 });
  });
  it("never starts a request for cancelled, disabled or expired work", async () => {
    const fetch = vi.fn(async () => "");
    await new DateEnrichment({ maxCards: 0 }).read("mirkvartir", identity, fetch);
    await new DateEnrichment({ deadline: 0 }).read("mirkvartir", identity, fetch);
    await new DateEnrichment().read("onrealt", identity, fetch, AbortSignal.abort());
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Seven saved source responses: scope of REPLAY evidence", () => {
  for (const source of ["cian", "avito", "domclick", "yandex", "mirkvartir", "onrealt", "youla"] as Source[]) it(`${source}: saved status/normalization and manual/feed fallback`, async () => {
    const saved = JSON.parse(read(`${dir}/${source}-response.json`));
    expect(saved).toMatchObject({ mode: "REPLAY", capturedFrom: "LIVE", source });
    for (const row of saved.normalized) {
      expect(row.source).toBe(source); expect(new URL(row.url).protocol).toBe("https:");
      expect(row.description).toBe(""); expect(row.seller.type).toBe("unknown");
    }
    if (["cian", "avito", "domclick"].includes(source)) {
      const status = saved.transportStatus;
      const file = source === "cian" ? "response-2.html" : "response-1.html";
      const base = vi.fn(async () => ({ data: read(`tests/fixtures/scraper/v31/${source}/${file}`), status, url: `https://${source}.ru/` }));
      const transport = resilientTransport(base, source, Date.now() + 1000);
      const request = { url: `https://${source}.ru/`, method: "GET", timeout: 500 } as RealEstateScraper.TransportRequest;
      await expect(transport(request)).rejects.toMatchObject({ code: "ACCESS_BLOCKED", status });
      await expect(transport(request)).rejects.toMatchObject({ code: "ACCESS_BLOCKED" }); expect(base).toHaveBeenCalledOnce();
    }
    
    const host = { cian: "cian.ru", avito: "avito.ru", domclick: "domclick.ru", yandex: "realty.yandex.ru", mirkvartir: "cre.mirkvartir.ru", onrealt: "onrealt.ru", youla: "youla.ru" }[source];
    const url = saved.normalized[0]?.url ?? `https://${host}/synthetic-acceptance`;
    expect(manualListing({ url, title: "Тестовый офис", operation: "sale", propertyType: "office" }).source).toBe(source);
    const feed = await importOfficialFeed(Buffer.from(`url,title,operation,propertyType\n${url},Тестовый офис,sale,office\n`), { source, format: "csv" });
    expect(feed.errors).toEqual([]); expect(feed.listings).toHaveLength(1);
    expect(normalizeListing({ source, id: "test", url, deal: "sale", propertyType: "office", title: "", description: "", price: null, area: null, address: null, rooms: null, floor: null, phone: null, images: [], city: null, district: null, timestamp: at }).publishedAt).toBeNull();
  });
});
