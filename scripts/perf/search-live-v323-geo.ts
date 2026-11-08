import { mkdirSync, writeFileSync } from "node:fs";
import { RealEstateScraperAdapter, defaultScraperFactory, type ScraperFactory } from "../../src/modules/property-search/infrastructure/scraper-adapter";
import { scraperHttpRequest } from "../../src/modules/property-search/infrastructure/scraper-http";
import { SEARCH_LOCATIONS, locationState } from "../../src/modules/property-search/domain/geography";
import { SearchFilters, type Source } from "../../src/modules/property-search/domain/types";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const retest = process.argv.includes("--retest");
const cap = retest ? 12 : 120;
let wireRequests = 0, lastRequest = 0;
const cells: Record<string, unknown>[] = [];
const blocked = new Map<Source, string>();
const sources: Source[] = ["mirkvartir", "onrealt", "youla"];
const types = [
  { name: "office", purposes: ["office"] }, { name: "warehouse", purposes: ["warehouse"] },
  { name: "retail", purposes: ["retail"] }, { name: "psn", purposes: ["free_purpose"] },
  { name: "apartments", propertyKinds: ["apartments"] }, { name: "flat", propertyKinds: ["flat"] },
  { name: "house", propertyKinds: ["house"] }, { name: "non_residential", propertyKinds: ["non_residential"] },
];
const factory: ScraperFactory = config => defaultScraperFactory({ ...config, dateDetailMaxCards: 0, transport: async request => {
  const response = await scraperHttpRequest(request.url, { method: request.method as "GET" | "POST", headers: request.headers, body: request.data === undefined ? undefined : typeof request.data === "string" ? request.data : JSON.stringify(request.data), signal: request.signal, timeoutMs: Math.min(request.timeout ?? 15000, 15000), maxBytes: 10_000_000, beforeRequest: async () => {
    if (wireRequests >= cap) throw Object.assign(new Error("LIVE_REQUEST_BUDGET"), { code: "LIVE_REQUEST_BUDGET" });
    await sleep(Math.max(0, 1100 - (Date.now() - lastRequest))); wireRequests++; lastRequest = Date.now();
  } });
  const text = response.data.toString("utf8"); let data: unknown = text;
  if (/json/iu.test(String(response.headers["content-type"]))) { try { data = JSON.parse(text); } catch {} }
  return { data, status: response.status, url: response.url };
} });
async function probe(source: Source, location: string, type: typeof types[number], operation: "sale" | "rent", filtered = false) {
 const raw = { city: "Новосибирск", operation, priceUnit: operation === "rent" ? "rub_month" : "rub_total", locations: [location], ...type, name: undefined, sources: [source], ...(filtered ? { priceFrom: "1000", priceTo: "10000000", areaFrom: 50, areaTo: 100, floorFrom: 1, floorTo: 5, hasPhotos: true, freshness: { mode: "published", period: "30", includeUnknown: true } } : {}) };
 delete raw.name;
 if (blocked.has(source) || wireRequests >= cap) { cells.push({ mode: "BLOCKED", source, location, type: type.name, operation, reason: blocked.get(source) ?? "request budget", requests: 0 }); return; }
 const filters = SearchFilters.parse(raw), before = wireRequests, at = Date.now();
 try {
  const adapter = new RealEstateScraperAdapter({ enabled: true, browserEnabled: false, enabledSources: [source], jobTimeoutMs: 20000, depth: { maxPages: 1, limit: 5 }, factory });
  const result = await adapter.searchDetailed(filters);
  const run = result.sources[0];
  const counts = { matched: 0, contradicted: 0, unknown: 0 };
  for (const item of result.listings) counts[locationState(item.listing, filters)]++;
  if (["needs_user_action", "blocked", "rate_limited"].includes(run?.status ?? "")) blocked.set(source, run?.status ?? "blocked");
  cells.push({ mode: wireRequests > before ? "LIVE" : "BLOCKED", source, location, type: type.name, operation, filtered, status: run?.status, reason: run?.reason, count: result.listings.length, locationCounts: counts, verdicts: Object.fromEntries(["confirmed", "needs_review", "rejected"].map(v => [v, result.listings.filter(i => i.evaluation.verdict === v).length])), fields: Object.fromEntries(["price", "area", "publishedAt"].map(k => [k, result.listings.filter(i => i.listing[k as "price" | "area" | "publishedAt"] != null).length])), requests: wireRequests - before, elapsedMs: Date.now() - at });
 } catch { cells.push({ mode: "LIVE", source, location, type: type.name, operation, status: "error", requests: wireRequests - before }); }
 save(); console.log(JSON.stringify(cells.at(-1)));
}
function save() { mkdirSync("docs/vkr", { recursive: true }); writeFileSync(retest ? "docs/vkr/live-search-v323-geo-retest.json" : "docs/vkr/live-search-v323-geo.json", JSON.stringify({ mode: "LIVE", updatedAt: new Date().toISOString(), aiCalls: 0, wireRequests, cap, sampling: "Location sweep plus type/operation coverage, not full Cartesian product; 5 cards per page; no seller contacts stored", cells }, null, 2) + "\n"); }
async function main() {
 if (retest) {
   for (const source of ["mirkvartir", "onrealt"] as Source[]) await probe(source, "akademgorodok", types[0]!, "rent");
   for (const location of ["koltsovo", "krasnoobsk"]) await probe("mirkvartir", location, types[0]!, "rent");
   await probe("mirkvartir", "berdsk", types[5]!, "sale", true);
   save(); return;
 }

 for (const source of [...sources, "cian", "yandex", "avito", "domclick"] as Source[]) await probe(source, "novosibirsk", types[0]!, "rent");
 for (const l of SEARCH_LOCATIONS.filter(l => l.id !== "suburbs")) for (const source of sources) await probe(source, l.id, types[0]!, "rent");
 for (const operation of ["rent", "sale"] as const) for (const type of types) for (const source of sources) await probe(source, "novosibirsk", type, operation, true);
 save();
}
main().catch(() => { save(); process.exitCode = 1; });
