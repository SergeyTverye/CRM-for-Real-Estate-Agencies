import * as audit from "@/modules/audit/application/audit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, type TestUsers } from "../helpers/fixtures";
import { resetConfigCache, getConfig } from "@/shared/config/env";
import { runSearch, getSearchRun, manualWebSearch, exportSearchCsv, parseQuery } from "@/modules/property-search/application/search-service";
import { setSelection, transferToCatalog, proposeListing, listingToOffer, saveSearch, verifyListing, clarifyListing, prefillSearch } from "@/modules/property-search/application/listing-service";
import { configureSearchAi } from "@/modules/property-search/application/dependencies";
import { SearchFilters, type NormalizedListing, type SearchResult } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { createSearchAi } from "@/modules/ai/infrastructure/create-search-ai";
import { FakeResponsesProvider, InMemoryAiLedger } from "@/modules/ai/infrastructure/fake";
import { FixtureScraperAdapter } from "@/modules/property-search/application/fixture-scraper";

vi.mock("@/shared/net/ssrf", async importOriginal => ({ ...await importOriginal<typeof import("@/shared/net/ssrf")>(), guardExternalUrl: vi.fn(async () => undefined) }));
let users: TestUsers;
const filters = SearchFilters.parse({ city: "Новосибирск", operation: "sale", purposes: ["retail"] });
function listing(price = "10000000.00", id: string | null = "synthetic-listing-1"): NormalizedListing {
  return { source: "cian", sourceListingId: id, sourceUnitId: null, url: "https://cian.ru/synthetic-listing-1", purpose: "retail", operation: "sale", price, priceUnit: "rub_total", area: 100,
    floor: { kind: "above_ground", number: 1, raw: "1" }, city: "Новосибирск", address: "Новосибирск, ул. Синтетическая, 10", district: "Центральный", seller: { type: "unknown" },
    description: "Отдельный вход. Витрина.", images: [], fetchedAt: new Date().toISOString(), structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: !id };
}
function adapter(listings = [listing()], statuses: SearchResult["sources"] = [{ source: "cian", status: "success", resultCount: listings.length, reason: null }]) {
  return { search: vi.fn(async () => ({ listings: listings.map(l => ({ listing: l, evaluation: evaluateListing(l, filters) })), sources: statuses })) };
}
async function search(listings = [listing()], savedSearchId?: string) {
  return runSearch(users.realtor1, { filters, sources: ["cian"], savedSearchId }, { scraper: adapter(listings) });
}
async function needFor(actor = users.realtor1) { const client = await makeClient(actor); return makeNeed(actor, client.id); }
async function gatedAi() {
  process.env.AI_ENABLED = "true"; process.env.YANDEX_WEB_SEARCH_ENABLED = "true"; process.env.YANDEX_WEB_SEARCH_AUTO_FALLBACK = "true"; resetConfigCache();
  await db.aiSetting.updateMany({ data: { aiEnabled: true, webSearchManualAllowed: true, webSearchAutoFallback: true } });
  const provider = new FakeResponsesProvider(() => ({ text: JSON.stringify({ candidates: [{ title: "Объявление требует проверки", url: "https://cian.ru/sale/commercial/999999999/" }] }), sourceUrls: ["https://cian.ru/sale/commercial/999999999/"], webSearchCalls: 1 }));
  const ai = createSearchAi(getConfig(), { ledger: new InMemoryAiLedger(), settings: { getLimits: async () => ({ enabled: true, webEnabled: true, autoFallback: true }) },
    tariffs: { findEffective: async model => ({ id: "synthetic-tariff", model, effectiveFrom: new Date(0), inputMicrosPerMillion: 1000000n, outputMicrosPerMillion: 1000000n, webSearchMicrosPerCall: 1000000n, webInputTokenAllowance: 1000 }) } }, provider);
  configureSearchAi(async () => ai);
  return { ai, provider };
}
beforeEach(async () => {
  await resetDatabase(); users = await seedBase();
  process.env.AI_ENABLED = "false"; process.env.YANDEX_WEB_SEARCH_ENABLED = "false"; process.env.YANDEX_WEB_SEARCH_AUTO_FALLBACK = "false"; resetConfigCache();
  configureSearchAi(async () => null);
  await db.aiSetting.create({ data: { scraperEnabled: true, enabledSources: ["cian", "avito"] } });
});
describe("search application integration", () => {
  it("round-trips multiple locations and property kinds in saved searches", async () => {
    const geoFilters = SearchFilters.parse({ operation: "sale", locations: ["berdsk", "ob"], propertyKinds: ["flat"], areaFrom: 50, areaTo: 100 });
    const saved = await saveSearch(users.realtor1, { name: "География v323", filters: geoFilters, sources: ["cian"] });
    const row = await db.savedSearch.findUniqueOrThrow({ where: { id: saved.id } });
    expect(SearchFilters.parse(row.filters)).toMatchObject({ locations: ["berdsk", "ob"], propertyKinds: ["flat"], areaFrom: 50, areaTo: 100 });
  });
  it("persists residential rejection and mixed-purpose review with their evidence", async () => {
    const residential = { ...listing(), purpose: null, description: "Квартира в квартале бизнес-класса…" };
    const mixed = { ...listing("10000000", "synthetic-mixed"), purpose: null, description: "ЖК: коммерческие помещения на первом этаже" };
    const structured = { ...listing("10000000", "synthetic-residential"), purpose: null, description: "Офисы в жилом комплексе", structuredFeatures: { category: "residential" } };
    const run = await search([residential, mixed, structured]);
    const saved = await getSearchRun(users.realtor1, run.id);
    expect(saved.results.find(r => r.listing.sourceListingId === residential.sourceListingId)).toMatchObject({ verdict: "rejected", criteria: expect.arrayContaining([
      { criterion: "purpose", state: "contradicted", source: "rule", evidence: residential.description },
    ]) });
    expect(saved.results.find(r => r.listing.sourceListingId === mixed.sourceListingId)?.verdict).toBe("needs_review");
    expect(saved.results.find(r => r.listing.sourceListingId === structured.sourceListingId)).toMatchObject({ verdict: "rejected", criteria: expect.arrayContaining([
      { criterion: "purpose", state: "contradicted", source: "structured", evidence: "category=residential" },
    ]) });
    expect(await db.aiUsageLog.count()).toBe(0);
  });
  it("candidate is independent; repeated transfer/proposal/offer has no duplicates", async () => {
    const need = await needFor(); const run = await search(); const listingId = run.results[0]!.listingId;
    await setSelection(users.realtor1, listingId, { needId: need.id, comment: "Позвонить" });
    expect(await db.property.count()).toBe(0); expect(await db.needPropertyMatch.count()).toBe(0);
    await expect(proposeListing(users.realtor1, listingId, { needId: need.id })).rejects.toMatchObject({ status: 409, code: "PROPERTY_REQUIRED" });
    await expect(listingToOffer(users.realtor1, listingId, { needId: need.id })).rejects.toMatchObject({ status: 409 });
    const transfers = await Promise.all([1, 2, 3].map(() => transferToCatalog(users.realtor1, listingId, { confirmed: true })));
    expect(new Set(transfers.map(t => t.id)).size).toBe(1); expect(await db.property.count()).toBe(1);
    await Promise.all([1, 2].map(() => proposeListing(users.realtor1, listingId, { needId: need.id })));
    expect(await db.needPropertyMatch.count()).toBe(1);
    const offer1 = await listingToOffer(users.realtor1, listingId, { needId: need.id });
    const offer2 = await listingToOffer(users.realtor1, listingId, { needId: need.id });
    expect(offer2.id).toBe(offer1.id); expect(await db.commercialOfferItem.count()).toBe(1);
    const property = await db.property.findFirstOrThrow(); expect(property.sourceType).toBe("external_market"); expect(property.sourceUrl).toContain("cian.ru");
  });
  it("offer from candidate adds a second property to existing draft, preserves snapshot", async () => {
    const need = await needFor(); const first = await search(); const a = first.results[0]!.listingId;
    await transferToCatalog(users.realtor1,a,{confirmed:true}); const offer = await listingToOffer(users.realtor1,a,{needId:need.id});
    const second = await search([listing("12000000", "synthetic-2")]); const b = second.results[0]!.listingId;
    await setSelection(users.realtor1,b,{needId:need.id}); await transferToCatalog(users.realtor1,b,{confirmed:true});
    const added = await listingToOffer(users.realtor1,b,{needId:need.id}); expect(added.id).toBe(offer.id);
    expect(await db.commercialOfferItem.count({where:{commercialOfferId:offer.id}})).toBe(2);
    expect(await db.needPropertyMatch.count()).toBe(0);
  });
  it("isNew/priceChanged use the last successful saved run, including numeric equality", async () => {
    const saved = await saveSearch(users.realtor1, { name: "Торговля", filters, sources: ["cian"] });
    const first = await search([listing()], saved.id); expect(first.results[0]!.isNew).toBe(true);
    const second = await search([listing("10000000")],saved.id); expect(second.results[0]).toMatchObject({ isNew:false,priceChanged:false });
    const third = await search([listing("11000000"),listing("20000000","synthetic-new")],saved.id);
    expect(third.results.find(r => r.listing.sourceListingId === "synthetic-listing-1")).toMatchObject({ isNew:false,priceChanged:true });
    expect(third.results.find(r => r.listing.sourceListingId === "synthetic-new")).toMatchObject({ isNew:true,priceChanged:false });
    const historical = await getSearchRun(users.realtor1,first.id); expect((historical.results[0]!.snapshot as unknown as NormalizedListing).price).toBe("10000000.00");
  });
  it("partial source failure preserves successful results and does not auto web search", async () => {
    const {provider,ai} = await gatedAi();
    const run = await runSearch(users.realtor1,{filters,sources:["cian","avito"],confirmedPaid:true}, {ai,scraper:adapter([listing()],[{source:"cian",status:"success",resultCount:1,reason:null},{source:"avito",status:"blocked",resultCount:0,reason:"HTTP 429"}])});
    expect(run.status).toBe("partial"); expect(run.results).toHaveLength(1); expect(provider.requests).toHaveLength(0);
  });
  it("compares repeated partial results and keeps their baseline after total failure", async () => {
    const saved = await saveSearch(users.realtor1, { name: "Частичная выдача", filters, sources: ["cian", "avito"] });
    const statuses: SearchResult["sources"] = [{ source: "cian", status: "success", resultCount: 1, reason: null }, { source: "avito", status: "blocked", resultCount: 0, reason: "HTTP 403" }];
    const first = await runSearch(users.realtor1, { filters, sources: ["cian", "avito"], savedSearchId: saved.id }, { scraper: adapter([listing()], statuses) });
    expect(first.status).toBe("partial");
    await runSearch(users.realtor1, { filters, sources: ["cian"], savedSearchId: saved.id }, { scraper: adapter([], [{ source: "cian", status: "timeout", resultCount: 0, reason: "TIMEOUT" }]) });
    expect((await db.savedSearch.findUniqueOrThrow({ where: { id: saved.id } })).lastSuccessfulRunId).toBe(first.id);
    const second = await runSearch(users.realtor1, { filters, sources: ["cian", "avito"], savedSearchId: saved.id }, { scraper: adapter([listing("11000000")], statuses) });
    expect(second.results[0]).toMatchObject({ isNew: false, priceChanged: true });
    expect((await getSearchRun(users.realtor1, first.id)).results).toHaveLength(1);
  });
  it("full failure auto web once through AiGate; manual retry cannot charge again", async () => {
    const {provider,ai} = await gatedAi();
    const run = await runSearch(users.realtor1,{filters,sources:["cian"],confirmedPaid:true},{ai,scraper:adapter([],[{source:"cian",status:"blocked",resultCount:0,reason:"HTTP 429"}])});
    expect(provider.requests).toHaveLength(1); expect(run.webSearchUsed).toBe(true); expect(run.sources.find(s=>s.source === "web_search")?.status).toBe("success");
    expect(run.results[0]).toMatchObject({verdict:"needs_review",listing:{source:"web_search",sourceMethod:"web_search"}});
    await expect(manualWebSearch(users.realtor1,run.id)).rejects.toMatchObject({code:"WEB_SEARCH_ALREADY_USED"}); expect(provider.requests).toHaveLength(1);
  });
  it("healthy empty reply and no enabled sources never auto web", async () => {
    const {provider,ai} = await gatedAi();
    const run = await runSearch(users.realtor1,{filters,sources:["cian"],confirmedPaid:true},{ai,scraper:adapter([])});
    expect(run.status).toBe("success"); expect(run.webSearchUsed).toBe(false);
    await runSearch(users.realtor1,{filters,sources:[],confirmedPaid:true},{ai,scraper:adapter([],[])}); expect(provider.requests).toHaveLength(0);
  });
  it("manual web is separate and requires permission; budget exhaustion never reaches provider", async () => {
    const run = await search([]);
    await expect(manualWebSearch(users.realtor1,run.id)).rejects.toMatchObject({code:"WEB_SEARCH_DISABLED"});
    const {provider} = await gatedAi();
    const manual = await manualWebSearch(users.realtor1,run.id);
    expect(manual.webSearchUsed).toBe(true); expect(provider.requests).toHaveLength(1);
    process.env.YANDEX_AI_MAX_MONTHLY_COST_RUB="0"; resetConfigCache();
    const fresh = await gatedAi();
    const denied = await runSearch(users.realtor1,{filters,sources:["cian"],confirmedPaid:true},{ai:fresh.ai,scraper:adapter([],[{source:"cian",status:"blocked",resultCount:0,reason:"HTTP 429"}])});
    expect(fresh.provider.requests).toHaveLength(0); expect(denied.webSearchUsed).toBe(false);
    expect(denied.sources.some(s=>s.source==="web_search")).toBe(false);
    expect(denied.fallbackReason).toContain("Бюджет или лимит");
    process.env.YANDEX_AI_MAX_MONTHLY_COST_RUB="1000"; resetConfigCache();
  });
  it("a saved search update requires current version", async () => {
    const saved = await saveSearch(users.realtor1,{name:"Исходный",filters,sources:["cian"]});
    const changed = await saveSearch(users.realtor1,{name:"Новый",filters,sources:["cian"],expectedUpdatedAt:saved.updatedAt.toISOString()},saved.id);
    expect(changed.name).toBe("Новый");
    await expect(saveSearch(users.realtor1,{name:"Затереть",filters,sources:["cian"],expectedUpdatedAt:new Date(0).toISOString()},saved.id)).rejects.toMatchObject({status:409,code:"STALE_UPDATE"});
  });
  it("verification stays separate from source; task links and CSV BOM exist", async () => {
    const need = await needFor(); const run = await search(); const id = run.results[0]!.listingId;
    const verification = await verifyListing(users.realtor1,id,{availability:"available",ownerConfirmed:true,priceConfirmed:true,note:"Проверено звонком"});
    expect(verification.verifiedBy).toBe(users.realtor1.userId); expect((await db.externalListing.findUniqueOrThrow({where:{id}})).ownerConfirmed).toBe(false);
    const task = await clarifyListing(users.realtor1,id,{needId:need.id,dueAt:new Date(Date.now()+86400000).toISOString()});
    expect(await db.taskNeed.count({where:{taskId:task.id}})).toBe(1);
    expect((await exportSearchCsv(users.realtor1,run.id)).startsWith("\uFEFF")).toBe(true);
    await expect(parseQuery(users.realtor1,"магазин",filters)).rejects.toMatchObject({status:409,code:"AI_DISABLED"});
    expect((await prefillSearch(users.realtor1,need.id)).city).toBe("Новосибирск");
  });
  it("missing identity requires explicit manual confirmation", async () => {
    const run = await search([listing("1000", null)]); const id = run.results[0]!.listingId;
    await expect(transferToCatalog(users.realtor1,id,{confirmed:true})).rejects.toMatchObject({code:"IDENTITY_CONFIRMATION_REQUIRED"});
    await transferToCatalog(users.realtor1,id,{confirmed:true,identityConfirmed:true}); expect(await db.property.count()).toBe(1);
  });
  it("a grouped listing without a unit requires confirmation even with an advertisement ID", async () => {
    const grouped = { ...listing(), identityNeedsReview: true };
    const run = await search([grouped]); const id = run.results[0]!.listingId;
    await expect(transferToCatalog(users.realtor1, id, { confirmed: true })).rejects.toMatchObject({ status: 409, code: "IDENTITY_CONFIRMATION_REQUIRED" });
    expect(await db.property.count()).toBe(0);
    await transferToCatalog(users.realtor1, id, { confirmed: true, identityConfirmed: true });
    expect(await db.property.count()).toBe(1);
  });
  it.each(["manual", "web_search"])("%s without a stable ID requires identity confirmation", async sourceMethod => {
    const run = await search(); const id = run.results[0]!.listingId;
    await db.externalListing.update({ where: { id }, data: { source: sourceMethod, sourceMethod, sourceListingId: null } });
    await expect(transferToCatalog(users.realtor1, id, { confirmed: true })).rejects.toMatchObject({ status: 409, code: "IDENTITY_CONFIRMATION_REQUIRED" });
    await transferToCatalog(users.realtor1, id, { confirmed: true, identityConfirmed: true });
  });
  it("keeps different units separate while concurrent transfers remain idempotent", async () => {
    const run = await search([ { ...listing(), sourceUnitId: "unit-1" }, { ...listing(), sourceUnitId: "unit-2" } ]);
    const ids = run.results.map(r => r.listingId);
    const moved = await Promise.all(ids.flatMap(id => [1, 2].map(() => transferToCatalog(users.realtor1, id, { confirmed: true }))));
    expect(new Set(moved.map(r => r.id)).size).toBe(2);
    expect(await db.property.count()).toBe(2);
  });
  it("rolls back match, stage, selection and audit together if proposal audit fails", async () => {
    const need = await needFor(); const run = await search(); const id = run.results[0]!.listingId;
    await transferToCatalog(users.realtor1, id, { confirmed: true });
    await setSelection(users.realtor1, id, { needId: need.id });
    const before = await db.clientNeed.findUniqueOrThrow({ where: { id: need.id } });
    const stageHistory = await db.needStageHistory.count();
    const auditCount = await db.auditLog.count();
    const original = audit.writeAudit;
    const failing = vi.spyOn(audit, "writeAudit").mockImplementation(async (tx, event) => {
      if (event.action === "property_search.proposed") throw new Error("Synthetic audit failure");
      return original(tx, event);
    });
    try {
      await expect(proposeListing(users.realtor1, id, { needId: need.id })).rejects.toThrow("Synthetic audit failure");
    } finally { failing.mockRestore(); }
    expect(await db.needPropertyMatch.count()).toBe(0);
    expect(await db.searchSelection.findFirst({ where: { needId: need.id } })).toMatchObject({ reviewStatus: "candidate", matchId: null });
    expect(await db.clientNeed.findUnique({ where: { id: need.id } })).toMatchObject({ stage: before.stage });
    expect(await db.needStageHistory.count()).toBe(stageHistory);
    expect(await db.auditLog.count()).toBe(auditCount);
    await proposeListing(users.realtor1, id, { needId: need.id });
    expect(await db.needPropertyMatch.count()).toBe(1);
  });
  it("deduplicates missing source IDs by canonical URL and preserves manual-review flags", async () => {
    const first = await search([{ ...listing("1000", null), url: "https://CIAN.ru/synthetic/?b=2&a=1&utm_source=one#photos" }]);
    const second = await search([{ ...listing("1000", null), url: "https://cian.ru/synthetic?a=1&b=2&utm_source=two" }]);
    expect(second.results[0]!.listingId).toBe(first.results[0]!.listingId);
    expect(second.results[0]!.listing.sourceListingId).toMatch(/^url:[a-f0-9]{64}$/u);
    expect(second.results[0]!.snapshot).toMatchObject({ identityNeedsReview: true });
    const noUrl = await search([{ ...listing("1000", null), url: "", identityNeedsReview: false }]);
    expect(noUrl.results[0]!.snapshot).toMatchObject({ sourceListingId: null, identityNeedsReview: true });
    await expect(transferToCatalog(users.realtor1, noUrl.results[0]!.listingId, { confirmed: true })).rejects.toMatchObject({ status: 409 });
  });
  it("repeated web runs share one listing and snapshot provenance agrees", async () => {
    const { ai, provider } = await gatedAi();
    const first = await runSearch(users.realtor1, { filters, sources: ["cian"], confirmedPaid: true }, { ai, scraper: adapter([]) });
    const second = await runSearch(users.realtor1, { filters, sources: ["cian"], confirmedPaid: true }, { ai, scraper: adapter([]) });
    const one = await manualWebSearch(users.realtor1, first.id);
    const two = await manualWebSearch(users.realtor1, second.id);
    expect(provider.requests).toHaveLength(2);
    expect(two.results[0]!.listingId).toBe(one.results[0]!.listingId);
    expect(two.results[0]!.snapshot).toMatchObject({ source: "web_search", sourceMethod: "web_search", identityNeedsReview: true });
    expect(two.results[0]!.listing).toMatchObject({ source: "web_search", sourceMethod: "web_search" });
    expect(await db.externalListing.count()).toBe(1);
    const available = await ai.checkWebSearchAvailability({ user: { userId: users.realtor1.userId, active: true }, ownerUserId: users.realtor1.userId, jobId: second.id, requestId: "preflight" }, filters);
    expect(available.limitAvailable).toBe(false);
  });
  it.each(["YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR", "YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB", "YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY"])("exhausted %s prevents auto fallback without consuming its attempt", async key => {
    const previous = process.env[key]; process.env[key] = "0";
    try {
      const { ai, provider } = await gatedAi();
      const run = await runSearch(users.realtor1, { filters, sources: ["cian"], confirmedPaid: true }, { ai, scraper: adapter([], [{ source: "cian", status: "blocked", resultCount: 0, reason: "Blocked" }]) });
      expect(run.webSearchUsed).toBe(false);
      expect(run.fallbackReason).toContain("Бюджет или лимит");
      expect(provider.requests).toHaveLength(0);
      expect(run.sources.some(s => s.source === "web_search")).toBe(false);
    } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; resetConfigCache(); }
  });
  it("repeated gate preflight does not reserve quota or budget", async () => {
    const previous = process.env.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR;
    process.env.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR = "1";
    try {
      const { ai, provider } = await gatedAi();
      const run = await runSearch(users.realtor1, { filters, sources: ["cian"], confirmedPaid: true }, { ai, scraper: adapter([]) });
      const context = { user: { userId: users.realtor1.userId, active: true }, ownerUserId: users.realtor1.userId, jobId: run.id, requestId: "preflight-only" };
      expect(await ai.checkWebSearchAvailability(context, filters)).toEqual({ budgetAvailable: true, limitAvailable: true });
      expect(await ai.checkWebSearchAvailability(context, filters)).toEqual({ budgetAvailable: true, limitAvailable: true });
      expect(provider.requests).toHaveLength(0);
      await manualWebSearch(users.realtor1, run.id);
      expect(provider.requests).toHaveLength(1);
      expect((await ai.checkWebSearchAvailability(context, filters)).limitAvailable).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR;
      else process.env.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR = previous;
      resetConfigCache();
    }
  });
  it("recorded fixtures cover success, partial, total failure and healthy empty", async () => {
    for (const scenario of ["success","partial","failure","empty"]) {
      const result = await new FixtureScraperAdapter({enabled:true,enabledSources:["cian","avito"]},scenario).search({...filters,city:"Москва",sources:["cian","avito"]});
      expect(result.sources.map(s=>s.status)).toEqual(scenario === "failure" ? ["blocked","blocked"] : scenario === "partial" ? ["success","blocked"] : ["success","success"]);
      if (scenario === "empty") expect(result.listings).toHaveLength(0);
    }
  });
  it("partial fixture preserves its first source across queue calls", async () => {
    const adapter = new FixtureScraperAdapter({enabled:true,enabledSources:["cian","avito"]}, "partial");
    const first = await adapter.search({...filters,city:"Москва",sources:["cian"]});
    const second = await adapter.search({...filters,city:"Москва",sources:["avito"]});
    expect(first.sources[0]?.status).toBe("success");
    expect(second.sources[0]?.status).toBe("blocked");
    expect(second.listings).toHaveLength(0);
  });
});
