import RealEstateScraper from "real-estate-scrapper";
import type { Browser, BrowserContext } from "playwright-core";
import { safeRequest } from "@/shared/net/ssrf";
import { SearchFilters, type SearchResult, type Source, type SourceRun } from "../domain/types";
import { evaluateListing } from "../domain/evaluation";
import { deduplicateListings, normalizeListing } from "./normalization";

export interface ScraperAdapter { search(input: unknown): Promise<SearchResult>; }
export type ScraperClient = Pick<RealEstateScraper, "searchSite" | "close">;
export type ScraperFactory = (config: RealEstateScraper.Config & { browser?: true | RealEstateScraper.BrowserOptions }) => Promise<ScraperClient>;
export class ScraperJobLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(readonly maximum = 1) { if (!Number.isInteger(maximum) || maximum < 1) throw new Error("INVALID_CONCURRENCY"); }
  async run<T>(job: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => { if (this.active < this.maximum) { this.active++; resolve(); } else this.queue.push(resolve); });
    try { return await job(); } finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }
}
export interface ScraperOptions {
  enabled?: boolean; browserEnabled?: boolean; enabledSources?: Source[];
  jobTimeoutMs?: number; maxConcurrentJobs?: number; limiter?: ScraperJobLimiter;
  sourceOptions?: RealEstateScraper.Query["sourceOptions"];
  browser?: RealEstateScraper.BrowserOptions;
  factory?: ScraperFactory;
}
const purposeMap = { retail: "retail", psn_universal: "freePurpose", free_purpose: "freePurpose", office: "office", production: "industrial", warehouse: "warehouse" } as const;
/** Price/owner/floor/district stay local: package filters can discard unknown candidates. */
export function buildScraperQuery(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"]): RealEstateScraper.Query {
  return { city: filters.city, category: "commercial", types: filters.purposes.length ? [...new Set(filters.purposes.map(p => purposeMap[p]))] : ["commercial"], deal: filters.operation,
    sources: [source], areaMin: filters.areaFrom, areaMax: filters.areaTo, maxPages: 2, limit: 100, signal, sourceOptions };
}
const transport: RealEstateScraper.Transport = async request => {
  if (!["GET", "POST"].includes(request.method.toUpperCase())) throw new Error("UNSUPPORTED_METHOD");
  const body = request.data === undefined ? undefined : typeof request.data === "string" ? request.data : JSON.stringify(request.data);
  const response = await safeRequest(request.url, { method: request.method.toUpperCase() as "GET" | "POST", headers: request.headers, body, signal: request.signal, timeoutMs: request.timeout, maxBytes: 10_000_000 });
  const text = response.data.toString("utf8");
  let data: unknown = text;
  if (/json/iu.test(String(response.headers["content-type"]))) { try { data = JSON.parse(text); } catch { /* Parser reports invalid payload. */ } }
  return { data, status: response.status, url: response.url };
};
/** Use the public browser lifecycle API to intercept ALL browser network, including subresources. */
export const defaultScraperFactory: ScraperFactory = async config => {
  const { browser, ...httpConfig } = config;
  if (!browser) return RealEstateScraper.create(httpConfig);
  const browserOptions = browser === true ? {} : browser;
  const launched = await RealEstateScraper.launchBrowserTransport(browserOptions);
  try {
    await (launched.context as BrowserContext).close();
    const context = await (launched.browser as Browser).newContext({ serviceWorkers: "block", locale: "ru-RU" });
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", async route => {
      const request = route.request();
      try {
        if (!["GET", "POST"].includes(request.method())) { await route.abort(); return; }
        const response = await safeRequest(request.url(), { method: request.method() as "GET" | "POST", headers: request.headers(), body: request.postData() ?? undefined, timeoutMs: config.timeout, maxBytes: 10_000_000, followRedirects: false });
        const headers = Object.fromEntries(Object.entries(response.headers).filter(([key, value]) => value !== undefined && !["content-encoding", "content-length", "transfer-encoding"].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]));
        await route.fulfill({ status: response.status, headers, body: response.data });
      } catch { await route.abort().catch(() => undefined); }
    });
    const sources = browserOptions.sources ?? ["cian", "avito"];
    const sourceConfigs = { ...httpConfig.sourceConfigs };
    const browserTransport = RealEstateScraper.createBrowserTransport({ context, timeout: browserOptions.timeout, settleMs: browserOptions.settleMs, waitForSelector: browserOptions.waitForSelector });
    const guardedBrowserTransport: RealEstateScraper.Transport = request => request.method.toUpperCase() !== "GET" && !request.browser ? transport(request) : browserTransport(request);
    for (const source of sources) sourceConfigs[source] = { ...sourceConfigs[source], transport: guardedBrowserTransport };
    const client = new RealEstateScraper({ ...httpConfig, sourceConfigs });
    return { searchSite: client.searchSite.bind(client), close: launched.close };
  } catch (error) { await launched.close(); throw error; }
};
function classify(errors: { code?: string; status?: number }[]): SourceRun["status"] {
  if (errors.some(e => e.code === "ACCESS_BLOCKED" || e.status === 403 || e.status === 429)) return "blocked";
  if (errors.some(e => /TIMEOUT|ABORTED|ETIMEDOUT/u.test(e.code ?? ""))) return "timeout";
  if (errors.length && errors.every(e => ["UNSUPPORTED_FILTER", "DISTRICT_RESOLUTION_REQUIRED", "NOT_APPLICABLE"].includes(e.code ?? ""))) return "unsupported_filter";
  return "error";
}
function positiveInt(value: unknown, fallback: number): number { const number = Number(value ?? fallback); if (!Number.isSafeInteger(number) || number < 1) throw new Error("INVALID_SCRAPER_LIMIT"); return number; }
// Shared process-wide limiter for production adapters; tests may inject an isolated limiter.
let productionLimiter: ScraperJobLimiter | undefined;
export class RealEstateScraperAdapter implements ScraperAdapter {
  private readonly limiter: ScraperJobLimiter;
  private readonly timeout: number;
  constructor(private readonly options: ScraperOptions = {}) {
    const maximum = positiveInt(options.maxConcurrentJobs ?? process.env.SCRAPER_MAX_CONCURRENT_JOBS, 1);
    this.limiter = options.limiter ?? (options.factory ? new ScraperJobLimiter(maximum) : productionLimiter ??= new ScraperJobLimiter(maximum));
    this.timeout = positiveInt(options.jobTimeoutMs ?? process.env.SCRAPER_JOB_TIMEOUT_MS, 180_000);
  }
  async search(input: unknown): Promise<SearchResult> {
    const filters = SearchFilters.parse(input);
    const runs = await Promise.all([...new Set(filters.sources)].map(source => this.runSource(source, filters)));
    const listings = deduplicateListings(runs.flatMap(r => r.listings));
    return { listings: listings.map(listing => ({ listing, evaluation: evaluateListing(listing, filters) })), sources: runs.map(r => r.run) };
  }
  private async runSource(source: Source, filters: SearchFilters) {
    const empty = (status: SourceRun["status"], reason: string) => ({ run: { source, status, resultCount: 0, reason } satisfies SourceRun, listings: [] as ReturnType<typeof normalizeListing>[] });
    if (!(this.options.enabled ?? process.env.SCRAPER_ENABLED === "true") || this.options.enabledSources && !this.options.enabledSources.includes(source)) return empty("disabled", "Источник отключён");
    const geography = this.options.sourceOptions?.[source];
    if (filters.city.toLocaleLowerCase("ru") !== "москва" && ((source === "domclick" && !geography?.address && !geography?.url) || (source === "avito" && !geography?.locationId && !geography?.url) || (source === "mirkvartir" && !geography?.locationIds && !geography?.url))) return empty("unsupported_filter", "Для города требуется проверенный идентификатор географии площадки в server sourceOptions");
    return this.limiter.run(async () => {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let client: ScraperClient | undefined;
      const browserEnabled = this.options.browserEnabled ?? process.env.SCRAPER_BROWSER_ENABLED !== "false";
      const factory = this.options.factory ?? defaultScraperFactory;
      const work = async () => {
        client = await factory({ timeout: Math.min(this.timeout, 30_000), maxRetries: 0, transport,
          ...(browserEnabled && ["cian", "avito"].includes(source) ? { browser: { channel: "chrome", ...this.options.browser, sources: [source] } } : {}) });
        if (controller.signal.aborted) { await client.close(); throw { code: "ABORTED" }; }
        return client.searchSite(source, buildScraperQuery(filters, source, controller.signal, this.options.sourceOptions));
      };
      try {
        const result = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject({ code: "TIMEOUT" }); }, this.timeout); })]);
        const listings: ReturnType<typeof normalizeListing>[] = []; let invalid = 0;
        for (const raw of result.results) { try { if (raw.source !== source) throw new Error("SOURCE_MISMATCH"); listings.push(normalizeListing(raw, result.timestamp)); } catch { invalid++; } }
        const successfulPage = result.pages.some(p => p.errors.length === 0);
        const errors = result.errors;
        const status: SourceRun["status"] = errors.length ? successfulPage || listings.length ? "partial" : classify(errors) : invalid || result.partial ? "partial" : "success";
        const limited = result.pages.some(p => p.hasNext === true || p.truncated);
        return { listings, run: { source, status, resultCount: listings.length,
          reason: errors.length ? errors.map(e => `${e.code}${e.status ? ` HTTP ${e.status}` : ""}`).join("; ") : invalid ? `Некорректные записи: ${invalid}` : limited ? "Выборка ограничена бюджетом страниц/результатов" : null } satisfies SourceRun };
      } catch (error) {
        const info = error && typeof error === "object" ? error as { code?: string; status?: number } : {};
        return empty(classify([info]), info.code ?? "SCRAPER_ERROR");
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        // close() is idempotent; race bounds cleanup even for faulty injected clients.
        if (client) { let cleanupTimer: ReturnType<typeof setTimeout> | undefined; await Promise.race([client.close().catch(() => undefined), new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000); })]); if (cleanupTimer) clearTimeout(cleanupTimer); }
      }
    });
  }
}
