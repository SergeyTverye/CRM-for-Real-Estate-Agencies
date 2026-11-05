import RealEstateScraper from "real-estate-scrapper";
import { SOURCES, SearchFilters } from "../../src/modules/property-search/domain/types";
import { buildScraperQuery, classifyScraperErrors, scraperErrorReason } from "../../src/modules/property-search/infrastructure/source-filters";
import { scraperHttpRequest } from "../../src/modules/property-search/infrastructure/scraper-http";

// One search per site, one page, no retries; up to three same-site HTTPS redirects.
const args = process.argv.slice(2);
const excluded = (args.find(a => a.startsWith("--exclude="))?.slice(10) ?? "").split(",");
const budget = Number(args.find(a => a.startsWith("--request-budget="))?.split("=")[1] ?? 2);
if (![1, 2, 3, 4].includes(budget)) throw new Error("REQUEST_BUDGET_MUST_BE_1_TO_4");
async function main() {
  for (const source of SOURCES.filter(s => !excluded.includes(s))) {
    const started = Date.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let requests = 0;
    const httpStatuses: number[] = [];
    const httpHops: { url: string; status: number; location?: string }[] = [];
    const scraper = new RealEstateScraper({ timeout: 60_000, delay: 0, maxRetries: 0, transport: async request => {
      const response = await scraperHttpRequest(request.url, { method: request.method as "GET" | "POST", headers: request.headers,
        body: request.data === undefined ? undefined : JSON.stringify(request.data), signal: controller.signal,
        timeoutMs: 60_000, maxBytes: 10_000_000,
        beforeRequest: () => { if (requests >= budget) throw new Error("SMOKE_REQUEST_BUDGET"); requests++; },
        onResponse: response => { httpStatuses.push(response.status); httpHops.push({ url: response.url, status: response.status, location: response.headers.location }); } });
      const text = response.data.toString("utf8");
      let data: unknown = text;
      if (/json/iu.test(String(response.headers["content-type"]))) { try { data = JSON.parse(text); } catch { /* parser validates */ } }
      return { data, status: response.status, url: response.url };
    } });
    try {
      const query = buildScraperQuery(SearchFilters.parse({ city: "Новосибирск", operation: "sale", purposes: ["office"], sources: [source] }), source, controller.signal);
      const result = await scraper.searchSite(source, { ...query, maxPages: 1 });
      const errors = result.errors;
      const status = errors.length ? result.results.length || result.pages.some(p => !p.errors.length) ? "partial" : classifyScraperErrors(errors) : "success";
      console.log(JSON.stringify({ date: new Date().toISOString(), platform: source, status, results: result.results.length,
        durationMs: Date.now() - started, requests, httpStatuses, httpHops, reason: errors.map(scraperErrorReason).join("; "),
        pages: result.pages.map(p => ({ page: p.page, total: p.total, hasNext: p.hasNext, truncated: p.truncated })) }));
    } catch {
      console.log(JSON.stringify({ date: new Date().toISOString(), platform: source, status: controller.signal.aborted ? "timeout" : "error", results: 0,
        durationMs: Date.now() - started, requests, httpStatuses, httpHops, reason: controller.signal.aborted ? "Лимит 60 секунд" : "SMOKE_FAILED" }));
    } finally { clearTimeout(timer); controller.abort(); await scraper.close(); }
  }
}
main().catch(() => { process.exitCode = 1; });
