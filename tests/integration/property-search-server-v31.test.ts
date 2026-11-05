import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { db, resetDatabase, seedBase, sessionCookieFor, apiRequest, routeParams, type TestUsers, makeClient, makeNeed, makeProperty } from "../helpers/fixtures";
import { POST as enqueueApi } from "@/app/api/v1/property-search/runs/route";
import { GET as resultsApi } from "@/app/api/v1/property-search/runs/[id]/results/route";
import { POST as exportApi } from "@/app/api/v1/property-search/runs/[id]/export/route";
import { POST as cancelApi } from "@/app/api/v1/property-search/runs/[id]/cancel/route";
import { GET as catalogApi } from "@/app/api/v1/property-search/filter-catalog/route";
import { SearchFilters, type NormalizedListing, type SearchResult } from "@/modules/property-search/domain/types";
import { enqueueSearch, processSearchQueue, recoverSearchQueue, cancelSearch } from "@/modules/property-search/application/search-queue";
import { exportSearch } from "@/modules/property-search/application/export-service";
import { saveSearch } from "@/modules/property-search/application/listing-service";
import { querySearchResults, SORTS } from "@/modules/property-search/queries/results-query";
import { bulkSearchAction } from "@/modules/property-search/application/bulk-service";
import { importSearchFeed, createListingFromUrl } from "@/modules/property-search/application/manual-import-service";
import { resetConfigCache } from "@/shared/config/env";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { runSearch } from "@/modules/property-search/application/search-service";
import { searchProgress } from "@/modules/property-search/application/progress-service";
import { attachInteractiveSearchAdapter } from "@/modules/property-search/application/browser-continuation";
import type { AdapterSearchResult } from "@/modules/property-search/infrastructure/scraper-adapter";
vi.mock("@/shared/net/ssrf", async original => ({ ...await original<typeof import("@/shared/net/ssrf")>(), guardExternalUrl: vi.fn(async (url: string) => { if (url.includes("127.0.0.1") || url.includes("localhost")) throw Error("UNSAFE"); }) }));
let users: TestUsers;
const filters = SearchFilters.parse({ operation: "sale", purposes: ["office"] });
const listing = (id = "one", price = "10000"): NormalizedListing => ({ source: "cian", sourceListingId: id, sourceUnitId: null, url: `https://cian.ru/synthetic/${id}`, purpose: "office", operation: "sale", price, priceUnit: "rub_total", area: 100, floor: { kind: "above_ground", number: 1, raw: "1" }, city: "Новосибирск", address: "=HYPERLINK(1)", district: null, seller: { type: "owner" }, description: "Офис", images: [], fetchedAt: "2026-11-05T10:00:00Z", publishedAt: "2026-11-04T17:00:00Z", dateSource: "cian:structured:publication", datePrecision: "day", structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: false });
function adapter(listings = [listing()], statuses: SearchResult["sources"] = [{ source: "cian", status: "success", resultCount: listings.length, reason: null }]) {
  return { search: vi.fn(async (input?: unknown) => { void input; return { listings: listings.map(listing => ({ listing, evaluation: evaluateListing(listing, filters) })), sources: statuses }; }) };
}
const enqueue = (key = "synthetic-one", sources = ["cian"]) => enqueueSearch(users.realtor1, { filters, sources, idempotencyKey: key });
beforeEach(async () => { await resetDatabase(); users = await seedBase(); process.env.AI_ENABLED = "false"; resetConfigCache(); });
describe("v3.1 queue, results, export and authorization", () => {
  it("concurrent repeated click creates one job and rejects changed inputs", async () => {
    const runs = await Promise.all([enqueue(), enqueue()]); expect(runs[0]!.id).toBe(runs[1]!.id);
    expect(await db.searchRun.count()).toBe(1);
    await expect(enqueueSearch(users.realtor1, { filters: { ...filters, city: "Москва" }, sources: ["cian"], idempotencyKey: "synthetic-one" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const foreign = await enqueueSearch(users.realtor2, { filters, sources: ["cian"], idempotencyKey: "synthetic-one" }); expect(foreign.id).not.toBe(runs[0]!.id);
  });
  it("persists dates, depth and candidates before CAPTCHA, preserving previous runs and snapshots", async () => {
    const first = await enqueue(); await processSearchQueue({ scraper: adapter() });
    const previous = await db.externalListingSnapshot.findFirstOrThrow({ where: { searchRunId: first.id } });
    expect(previous.datePrecision).toBe("day"); expect(previous.pricePerM2Rub?.toString()).toBe("100");
    const next = await enqueue("synthetic-next", ["cian", "avito"]);
    const real = { search: vi.fn(), searchDetailed: vi.fn(async (input: unknown): Promise<AdapterSearchResult> => {
      const source = (input as { sources: string[] }).sources[0]!;
      const depth = { maxPages: 2, limit: 100, estimatedRequests: 2, listingsFetched: 0 };
      return source === "cian" ? { listings: [{ listing: { ...listing("one", "11000"), title: "Офис", publishedAt: "2026-11-04T17:00:00Z", sourceUpdatedAt: null, dateSource: "site_published", datePrecision: "day" }, evaluation: evaluateListing(listing(), filters) }], sources: [{ ...depth, source: "cian", status: "success", resultCount: 1, reason: null, pagesFetched: 2, listingsFetched: 1, incomplete: true }] }
        : { listings: [], sources: [{ ...depth, source: "avito", status: "needs_user_action", resultCount: 0, reason: "Проверка сотрудника", pagesFetched: 0, incomplete: true }] };
    }) };
    await processSearchQueue({ scraper: real }); expect(real.search).not.toHaveBeenCalled();
    expect(await db.searchRun.findUnique({ where: { id: next.id } })).toMatchObject({ status: "needs_user_action" });
    expect(await db.searchRunResult.count({ where: { runId: next.id } })).toBe(1);
    expect(await db.externalListingSnapshot.findUnique({ where: { id: previous.id } })).toMatchObject({ priceRub: previous.priceRub });
    expect((await searchProgress(users.realtor1, next.id)).sources.find(s => s.source === "cian")?.depthReached).toBe(2);
    expect((await searchProgress(users.realtor1, next.id)).sources.find(s => s.source === "avito")?.browserSessionAction?.url).toBe("/api/v1/browser-sessions");
  });
  it("one durable worker slot, user cancellation aborts and keeps completed sources", async () => {
    const run = await enqueue("synthetic-cancel", ["cian", "avito"]); await enqueue("synthetic-pending");
    let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
    const scraper = { search: vi.fn(async (input: unknown, context?: { signal?: AbortSignal }) => {
      if ((input as { sources: string[] }).sources[0] === "cian") return adapter().search();
      entered(); return new Promise<SearchResult>(resolve => context?.signal?.addEventListener("abort", () => resolve({ listings: [], sources: [{ source: "avito", status: "timeout", resultCount: 0, reason: "Остановлено" }] }), { once: true }));
    }) };
    const work = processSearchQueue({ scraper }); await waiting;
    expect(await processSearchQueue({ scraper: adapter() })).toBe(false);
    await cancelSearch(users.realtor1, run.id); await work;
    expect(await db.searchRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: "partial", cancelRequested: true });
    expect(await db.searchRunResult.count({ where: { runId: run.id } })).toBe(1);
  });
  it("restart requeues an unexpired lease and skips sources already committed", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter() });
    await db.searchRun.update({ where: { id: run.id }, data: { status: "running", lockedBy: "dead", heartbeatAt: new Date(0) } });
    expect(await recoverSearchQueue()).toBe(1); expect(await recoverSearchQueue()).toBe(0);
    expect(await db.externalListingSnapshot.count()).toBe(1); expect(await db.searchRunResult.count()).toBe(1);
    const scraper = adapter();
    expect(await processSearchQueue({ scraper })).toBe(true);
    expect(scraper.search).not.toHaveBeenCalled();
    expect(await db.externalListingSnapshot.count()).toBe(1);
    expect(await db.searchRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: "completed", lockedBy: null });
  });
  it("restart resumes an interrupted source, while an expired lease never issues requests", async () => {
    const run = await enqueue("restart-sources", ["cian", "avito"]);
    await db.searchRun.update({ where: { id: run.id }, data: { status: "running", lockedBy: "dead", heartbeatAt: new Date(0) } });
    await db.searchRunSource.update({ where: { runId_source: { runId: run.id, source: "avito" } }, data: { status: "running" } });
    await db.searchRunSource.update({ where: { runId_source: { runId: run.id, source: "cian" } }, data: { status: "success" } });
    const scraper = adapter([], [{ source: "avito", status: "success", resultCount: 0, reason: null }]);
    expect(await processSearchQueue({ scraper })).toBe(true);
    expect(scraper.search).toHaveBeenCalledTimes(1);
    expect(scraper.search.mock.calls[0]?.[0]).toMatchObject({ sources: ["avito"] });
    const expired = await enqueue("expired-lease");
    await db.searchRun.update({ where: { id: expired.id }, data: { status: "running", lockedBy: "dead", heartbeatAt: new Date(0), deadlineAt: new Date(0) } });
    expect(await recoverSearchQueue()).toBe(1);
    expect(await processSearchQueue({ scraper })).toBe(false);
    expect(await db.searchRun.findUnique({ where: { id: expired.id } })).toMatchObject({ status: "partial", lockedBy: null });
  });
  it("deadline releases the durable slot even for an adapter that ignores AbortSignal", async () => {
    const run = await enqueueSearch(users.realtor1, { filters, sources: ["cian"], idempotencyKey: "ignored-abort", deadlineMs: 1000 });
    await processSearchQueue({ scraper: { search: () => new Promise<SearchResult>(() => undefined) } });
    expect(await db.searchRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: "partial", lockedBy: null });
  });
  it("exports all filtered and selected rows with BOM/formula protection and SearchExport journal", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter([listing("one"), listing("two")]) });
    const page = await querySearchResults(users.realtor1, run.id);
    const csv = await exportSearch(users.realtor1, run.id, { columns: ["address", "url", "datePrecision"] });
    expect(Buffer.from(csv.bytes).subarray(0, 3).toString("hex")).toBe("efbbbf"); expect(Buffer.from(csv.bytes).toString()).toContain("'=HYPERLINK");
    const xlsx = await exportSearch(users.realtor1, run.id, { format: "xlsx", ids: [page.rows[0]!.listingId], columns: ["address", "url"] });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(xlsx.bytes) as never);
    expect(book.worksheets[0]!.rowCount).toBe(2); expect(book.worksheets[0]!.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(await db.searchExport.findUnique({ where: { id: xlsx.exportId } })).toMatchObject({ scope: "selected", rowCount: 1, columns: ["address", "url"] });
    await expect(exportSearch(users.realtor2, run.id, {})).rejects.toMatchObject({ status: 404 });
    await expect(cancelSearch(users.realtor2, run.id)).rejects.toMatchObject({ status: 404 });
  });
  it("all server sort orders have stable pagination and require revision on subsequent pages", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter([listing("one"), listing("two"), listing("three")]) });
    for (const sort of SORTS) {
      const a = await querySearchResults(users.realtor1, run.id, { sort, pageSize: 2 });
      const b = await querySearchResults(users.realtor1, run.id, { sort, page: 2, pageSize: 2, revision: a.revision });
      expect(new Set([...a.rows, ...b.rows].map(r => r.id)).size).toBe(3);
      expect(a.counts.confirmed).toBe(3);
    }
    await expect(querySearchResults(users.realtor1, run.id, { page: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(querySearchResults(users.realtor2, run.id)).rejects.toMatchObject({ status: 404 });
  });
  it("revision catches changed scores even when row count and snapshot dates stay equal", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter([listing("one"), listing("two")]) });
    const page = await querySearchResults(users.realtor1, run.id, { pageSize: 1 });
    await db.searchRunResult.update({ where: { id: String(page.rows[0]!.id) }, data: { score: 50 } });
    await expect(querySearchResults(users.realtor1, run.id, { page: 2, pageSize: 1, revision: page.revision })).rejects.toMatchObject({ code: "SEARCH_RESULTS_CHANGED" });
  });
  it("exports beyond the first server page and rejects foreign selected ids", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter(Array.from({ length: 205 }, (_, i) => listing(`many-${i}`))) });
    const exported = await exportSearch(users.realtor1, run.id, { columns: ["url"] });
    expect((await db.searchExport.findUniqueOrThrow({ where: { id: exported.exportId } })).rowCount).toBe(205);
    expect(Buffer.from(exported.bytes).toString().split("\r\n")).toHaveLength(206);
    await expect(exportSearch(users.realtor1, run.id, { ids: [users.realtor2.userId] })).rejects.toMatchObject({ status: 404 });
  });
  it("freshness keeps unknown publications separate and first_seen uses CRM observations", async () => {
    const run = await enqueue();
    await processSearchQueue({ scraper: adapter([listing("known"), { ...listing("unknown"), publishedAt: null, sourceUpdatedAt: "2026-11-05T10:00:00Z", datePrecision: "exact", dateSource: "site_updated" }]) });
    const f = { mode: "published", period: "custom", from: "2026-11-05", to: "2026-11-05", includeUnknown: true };
    const known = await querySearchResults(users.realtor1, run.id, { freshness: f });
    const unknown = await querySearchResults(users.realtor1, run.id, { freshness: f, unknownDates: true });
    expect(known.total).toBe(1); expect(unknown.total).toBe(1); expect(unknown.rows[0]!.publishedAt).toBeNull();
    const sorted = await querySearchResults(users.realtor1, run.id, { sort: "publication", direction: "desc" });
    expect(sorted.rows[0]!.publishedAt).not.toBeNull(); expect(sorted.rows[1]!.publishedAt).toBeNull();
    const firstSeen = await querySearchResults(users.realtor1, run.id, { freshness: { ...f, mode: "first_seen" } });
    expect(firstSeen.total).toBe(2);
  });
  it("API requires a session, deduplicates jobs and denies direct foreign result/export/cancel URLs", async () => {
    expect((await catalogApi(apiRequest("GET", "/api/v1/property-search/filter-catalog"), routeParams({}))).status).toBe(401);
    const cookie = await sessionCookieFor(users.realtor1), foreign = await sessionCookieFor(users.realtor2);
    const body = { filters, sources: ["cian"], idempotencyKey: "api-repeated-click" };
    const a = await enqueueApi(apiRequest("POST", "/api/v1/property-search/runs", { cookie, body }), routeParams({}));
    const b = await enqueueApi(apiRequest("POST", "/api/v1/property-search/runs", { cookie, body }), routeParams({}));
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    const { id } = await a.json(); expect((await b.json()).id).toBe(id);
    for (const [handler, method, suffix] of [[resultsApi, "GET", "results"], [exportApi, "POST", "export"], [cancelApi, "POST", "cancel"]] as const) {
      const response = await handler(apiRequest(method, `/api/v1/property-search/runs/${id}/${suffix}`, { cookie: foreign, ...(method === "POST" ? { body: {} } : {}) }), routeParams({ id }));
      expect(response.status).toBe(404);
    }
  });
  it("bulk actions require an owned run and membership; collection add is idempotent and creates no Property", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter() });
    const rows = await querySearchResults(users.realtor1, run.id), ids = rows.rows.map(r => String(r.listingId));
    await expect(bulkSearchAction(users.realtor2, run.id, { ids, action: "bookmark", data: { status: "study" } })).rejects.toMatchObject({ status: 404 });
    const collection = await db.propertyCollection.create({ data: { name: "Синтетика", ownerUserId: users.realtor1.userId } });
    for (let i = 0; i < 2; i++) expect((await bulkSearchAction(users.realtor1, run.id, { ids, action: "collection", data: { collectionId: collection.id } })).results[0]?.success).toBe(true);
    expect(await db.propertyCollectionItem.count()).toBe(1); expect(await db.property.count()).toBe(0); expect(await db.needPropertyMatch.count()).toBe(0);
  });
  it("feed dry-run writes nothing; commit validates URLs and stores candidates, manual link forbids SSRF", async () => {
    const bytes = "url;title;operation;propertyType;price;area;city\nhttps://cian.ru/synthetic/one;Office;sale;office;10000;100;Новосибирск";
    const file = () => new File([bytes], "synthetic.csv", { type: "text/csv" });
    const input = { source: "cian", format: "csv", filters };
    expect((await importSearchFeed(users.realtor1, file(), input)).preview).toHaveLength(1);
    expect(await db.externalListing.count()).toBe(0);
    const saved = await importSearchFeed(users.realtor1, file(), { ...input, commit: true }); expect(saved).toMatchObject({ importedCount: 1 });
    expect(await db.externalListing.count()).toBe(1);
    await expect(createListingFromUrl(users.realtor1, { url: "http://127.0.0.1/private", filters })).rejects.toMatchObject({ status: 400 });
    expect((await createListingFromUrl(users.realtor1, { url: "https://cian.ru/synthetic/two", filters, manual: { title: "Офис", operation: "sale", propertyType: "office", city: "Новосибирск" } })).status).toBe("success");
  });
  it("rate-limited repeat does not erase earlier snapshots or baseline", async () => {
    const first = await runSearch(users.realtor1, { filters, sources: ["cian"] }, { scraper: adapter() });
    const run = await enqueue(); await processSearchQueue({ scraper: { search: async () => ({ listings: [], sources: [{ source: "cian", status: "blocked", resultCount: 0, reason: "HTTP 429" }] }) } });
    expect(await db.externalListingSnapshot.count({ where: { searchRunId: first.id } })).toBe(1);
    expect(await db.searchRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: "partial" });
  });
  it("repeat compares compatible prices and does not call a previously blocked listing new", async () => {
    const scraper = (price: string, blockAvito = false) => ({ search: async (raw: unknown): Promise<SearchResult> => {
      const source = (raw as SearchFilters).sources[0]!;
      if (source === "avito" && blockAvito) return { listings: [], sources: [{ source, status: "blocked", resultCount: 0, reason: "HTTP 429" }] };
      const value = { ...listing(source, price), source, url: `https://${source}.ru/synthetic/repeat` };
      return { listings: [{ listing: value, evaluation: evaluateListing(value, filters) }], sources: [{ source, status: "success", resultCount: 1, reason: null }] };
    } });
    await enqueue("price-first", ["cian", "avito"]); await processSearchQueue({ scraper: scraper("10000") });
    const second = await enqueue("price-second", ["cian", "avito"]); await processSearchQueue({ scraper: scraper("11000", true) });
    expect((await querySearchResults(users.realtor1, second.id)).rows[0]).toMatchObject({ isNew: false, priceChanged: true });
    const third = await enqueue("price-third", ["cian", "avito"]); await processSearchQueue({ scraper: scraper("11000") });
    const results = await querySearchResults(users.realtor1, third.id);
    expect(results.rows).toHaveLength(2); expect(results.rows.every(row => row.isNew === false)).toBe(true);
    expect(results.rows.find(row => row.source === "avito")).toMatchObject({ priceChanged: true });
  });
  it("identical saved profile preserves novelty and flags only an observed compatible price change", async () => {
    const saved = await saveSearch(users.realtor1, { name: "Синтетический повтор", filters, sources: ["cian"] });
    const launch = (key: string) => enqueueSearch(users.realtor1, { filters, sources: ["cian"], savedSearchId: saved.id, idempotencyKey: key });
    const first = await launch("saved-profile-first"); await processSearchQueue({ scraper: adapter() });
    const second = await launch("saved-profile-unchanged"); await processSearchQueue({ scraper: adapter() });
    expect((await querySearchResults(users.realtor1, first.id)).rows[0]).toMatchObject({ isNew: true, priceChanged: false });
    expect((await querySearchResults(users.realtor1, second.id)).rows[0]).toMatchObject({ isNew: false, priceChanged: false });
    const third = await launch("saved-profile-price"); await processSearchQueue({ scraper: adapter([listing("one", "12000")]) });
    expect((await querySearchResults(users.realtor1, third.id)).rows[0]).toMatchObject({ isNew: false, priceChanged: true });
    const file = await exportSearch(users.realtor1, third.id, { format: "xlsx", columns: ["url", "publishedAt", "area", "price"] });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(file.bytes) as never);
    const sheet = book.worksheets[0]!;
    expect(sheet.getCell("A2").hyperlink).toBe("https://cian.ru/synthetic/one");
    expect(sheet.getCell("B2").value).toBeInstanceOf(Date);
    expect(sheet.getCell("C2").value).toBe(100); expect(sheet.getCell("D2").value).toBe(12000);
  });
  it("groups after ingestion and exports every active group URL even when only one listing is selected", async () => {
    const run = await enqueue("group-ingestion", ["cian", "avito"]);
    await processSearchQueue({ scraper: { search: async (raw: unknown): Promise<SearchResult> => {
      const source = (raw as SearchFilters).sources[0]!;
      const value = { ...listing(), source, url: `https://${source}.ru/synthetic/one`, address: "Новосибирск, улица Ленина, дом 10, помещение 2" };
      return { listings: [{ listing: value, evaluation: evaluateListing(value, filters) }], sources: [{ source, status: "success", resultCount: 1, reason: null }] };
    } } });
    const result = await querySearchResults(users.realtor1, run.id, { pageSize: 1 });
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0]!.members.filter(m => !m.releasedAt)).toHaveLength(2);
    const csv = await exportSearch(users.realtor1, run.id, { ids: [result.rows[0]!.listingId], columns: ["links"] });
    expect(Buffer.from(csv.bytes).toString()).toContain("https://cian.ru/synthetic/one");
    expect(Buffer.from(csv.bytes).toString()).toContain("https://avito.ru/synthetic/one");
  });
  it("continuation uses the supplied browser context and commits once; blocked keeps snapshots", async () => {
    const run = await enqueue(); await processSearchQueue({ scraper: adapter() });
    await db.searchRun.update({ where: { id: run.id }, data: { status: "needs_user_action" } });
    await db.searchRunSource.update({ where: { runId_source: { runId: run.id, source: "cian" } }, data: { status: "needs_user_action", needsUserAction: true } });
    const collect = vi.fn(async () => ({ listings: [listing("continued")], blocked: false, depthReached: 1, incomplete: false }));
    const port = attachInteractiveSearchAdapter({ prepare: async () => ({ startUrl: "https://www.cian.ru/", parameters: { synthetic: true } }), isReady: async () => true, collect });
    await expect(port.prepare(users.realtor2, run.id, "cian")).rejects.toMatchObject({ status: 404 });
    expect((await port.prepare(users.realtor1, run.id, "cian")).parameters).toEqual({ synthetic: true });
    const input = { actor: users.realtor1, runId: run.id, source: "cian" as const, parameters: {}, page: {} as never, context: {} as never, signal: new AbortController().signal };
    expect(await port.resume(input)).toBe("completed"); expect(collect).toHaveBeenCalledWith(input);
    expect(await db.externalListingSnapshot.count()).toBe(2);
    expect(await port.resume(input)).toBe("blocked"); expect(await db.externalListingSnapshot.count()).toBe(2);
    expect(collect).toHaveBeenCalledTimes(1);
    await db.searchRun.update({ where: { id: run.id }, data: { status: "needs_user_action" } });
    await db.searchRunSource.update({ where: { runId_source: { runId: run.id, source: "cian" } }, data: { status: "needs_user_action", needsUserAction: true } });
    await port.blocked(run.id, "cian", "blocked");
    expect(await db.searchRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: "partial" });
    expect(await db.externalListingSnapshot.count()).toBe(2);
  });
});

it("page metadata survives a new read and hides private bookmarks, collections and proposed needs", async () => {
  const run = await enqueue(); await processSearchQueue({ scraper: adapter([listing("one"), listing("two")]) });
  const initial = await querySearchResults(users.realtor1, run.id, { pageSize: 1 });
  const id = String(initial.rows[0]!.listingId);
  const property = await makeProperty(users.realtor1);
  await db.externalListing.update({ where: { id }, data: { propertyId: property.id } });
  const privateCollection = await db.propertyCollection.create({ data: { name: "Hidden", ownerUserId: users.realtor2.userId } });
  await db.propertyCollectionItem.create({ data: { collectionId: privateCollection.id, externalListingId: id, addedBy: users.realtor2.userId } });
  await db.searchBookmark.create({ data: { userId: users.realtor2.userId, listingId: id, note: "Hidden" } });
  const foreignClient = await makeClient(users.realtor2); const foreignNeed = await makeNeed(users.realtor2, foreignClient.id);
  await db.needPropertyMatch.create({ data: { clientNeedId: foreignNeed.id, propertyId: property.id, status: "proposed", createdBy: users.realtor2.userId } });
  const hidden = await querySearchResults(users.realtor1, run.id, { pageSize: 1 });
  expect(hidden.rows[0]).toMatchObject({ propertyId: property.id, bookmark: false, inCollection: false, proposed: false, collectionIds: [], note: null });
  const ownCollection = await db.propertyCollection.create({ data: { name: "Own", ownerUserId: users.realtor1.userId } });
  await db.propertyCollectionItem.create({ data: { collectionId: ownCollection.id, externalListingId: id, addedBy: users.realtor1.userId } });
  await db.searchBookmark.create({ data: { userId: users.realtor1.userId, listingId: id, note: "Visible" } });
  const ownClient = await makeClient(users.realtor1); const ownNeed = await makeNeed(users.realtor1, ownClient.id);
  await db.needPropertyMatch.create({ data: { clientNeedId: ownNeed.id, propertyId: property.id, status: "proposed", createdBy: users.realtor1.userId } });
  const restored = await querySearchResults({ ...users.realtor1 }, run.id, { pageSize: 1 });
  expect(restored.rows).toHaveLength(1);
  expect(restored.rows[0]).toMatchObject({ propertyId: property.id, bookmark: true, inCollection: true, proposed: true, collectionIds: [ownCollection.id], note: "Visible" });
  expect(JSON.stringify(restored.rows)).not.toContain(privateCollection.id);
  await db.propertyCollection.update({ where: { id: ownCollection.id }, data: { archivedAt: new Date() } });
  expect((await querySearchResults(users.realtor1, run.id, { pageSize: 1 })).rows[0]!.inCollection).toBe(false);
});
