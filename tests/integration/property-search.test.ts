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
  const provider = new FakeResponsesProvider(() => ({ text: JSON.stringify({ candidates: [{ title: "Объявление требует проверки", url: "https://cian.ru/synthetic-web" }] }), sourceUrls: ["https://cian.ru/synthetic-web"], webSearchCalls: 1 }));
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
    expect(fresh.provider.requests).toHaveLength(0); expect(denied.webSearchUsed).toBe(true);
    expect(denied.sources.find(s=>s.source==="web_search")?.status).toBe("error");
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
  it("recorded fixtures cover success, partial, total failure and healthy empty", async () => {
    for (const scenario of ["success","partial","failure","empty"]) {
      const result = await new FixtureScraperAdapter({enabled:true,enabledSources:["cian","avito"]},scenario).search({...filters,city:"Москва",sources:["cian","avito"]});
      expect(result.sources.map(s=>s.status)).toEqual(scenario === "failure" ? ["blocked","blocked"] : scenario === "partial" ? ["success","blocked"] : ["success","success"]);
      if (scenario === "empty") expect(result.listings).toHaveLength(0);
    }
  });
});
