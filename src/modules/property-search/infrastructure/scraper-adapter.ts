import RealEstateScraper from "real-estate-scrapper";
import { chromium, type BrowserContext } from "playwright-core";
import { safeRequest } from "@/shared/net/ssrf";
import { SearchFilters, type SearchResult, type Source, type SourceRun } from "../domain/types";
import { evaluateListing } from "../domain/evaluation";
import { deduplicateListings, normalizeListing } from "./normalization";
import { buildScraperQueries, resolveSourceGeography, classifyScraperErrors as classify, scraperErrorReason } from "./source-filters";
import { scraperHttpRequest } from "./scraper-http";
import { extendSourceParsers, dateEnrichmentProgress } from "./parser-extension";
import { resilientTransport, type AdapterFailure } from "./source-response";
import { boundSourceQueries, resolveSourceDepth, type DepthOptions } from "./source-limits";
import type { DateDetailProgress } from "./date-enrichment";

export interface AdapterSourceRun extends Omit<SourceRun, "status"> {
  status: SourceRun["status"] | AdapterFailure;
  incomplete: boolean; pagesFetched: number; listingsFetched: number;
  /** Aggregate planned page allowance over all package category variants. */
  maxPages: number; limit: number; estimatedRequests: number;
  actionUrl?: string;
  failureCode?: string;
  dateDetails?: DateDetailProgress;
}
export interface AdapterSearchResult extends Omit<SearchResult, "sources" | "listings"> {
  sources: AdapterSourceRun[];
  listings: { listing: ReturnType<typeof normalizeListing>; evaluation: SearchResult["listings"][number]["evaluation"] }[];
}
function failure(errors: { code?: string; status?: number }[]): AdapterSourceRun["status"] {
  if (errors.some(e => e.code === "NEEDS_USER_ACTION")) return "needs_user_action";
  if (errors.some(e => e.code === "RATE_LIMITED" || e.status === 429)) return "rate_limited";
  if (errors.some(e => e.status === 439)) return "blocked";
  if (errors.some(e => e.code === "PARSE_FAILED" || e.code === "INVALID_RESPONSE" || e.code === "API_RESPONSE_FAILED")) return "parse_failed";
  if (errors.some(e => e.code === "ABORTED")) return "cancelled";
  return classify(errors);
}
export { buildScraperQueries, buildScraperQuery } from "./source-filters";

export interface ScraperAdapter {
  search(input: unknown, context?: { signal?: AbortSignal; deadline?: number }): Promise<SearchResult>;
  searchDetailed?(input: unknown, context?: { signal?: AbortSignal; deadline?: number }): Promise<AdapterSearchResult>;
}
export type ScraperClient = Pick<RealEstateScraper, "searchSite" | "close">;
export type ScraperFactory = (config: RealEstateScraper.Config & { browser?: true | RealEstateScraper.BrowserOptions; jobDeadlineAt?: number; dateDetailMaxCards?: number }) => Promise<ScraperClient>;
/** A small HTTP-200 challenge is not an empty market or a selector regression. */
export function isCianAccessChallenge(url: string, data: unknown): boolean {
  const host = new URL(url).hostname;
  return (host === "cian.ru" || host.endsWith(".cian.ru")) && typeof data === "string" && data.length < 20000 &&
    /captcha|подтвердите.{0,40}человек|проверка браузера/iu.test(data) && !/legacy-commercial-serp-frontend|OfferCard/u.test(data);
}
export class ScraperJobLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(readonly maximum = 1) { if (!Number.isInteger(maximum) || maximum < 1) throw new Error("INVALID_CONCURRENCY"); }
  async run<T>(job: () => Promise<T>, context: { signal?: AbortSignal; deadline?: number } = {}): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { if (timer) clearTimeout(timer); context.signal?.removeEventListener("abort", abort); };
      const start = () => { cleanup(); resolve(); };
      const fail = (code: string) => { const index = this.queue.indexOf(start); if (index >= 0) this.queue.splice(index, 1); cleanup(); reject({ code }); };
      const abort = () => fail("ABORTED");
      if (context.signal?.aborted) { abort(); return; }
      if (context.deadline !== undefined && context.deadline <= Date.now()) { fail("TIMEOUT"); return; }
      if (this.active < this.maximum) { this.active++; start(); }
      else {
        this.queue.push(start);
        context.signal?.addEventListener("abort", abort, { once: true });
        if (context.deadline !== undefined) timer = setTimeout(() => fail("TIMEOUT"), Math.max(1, context.deadline - Date.now()));
      }
    });
    try { return await job(); } finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }
}
export interface ScraperOptions {
  enabled?: boolean; browserEnabled?: boolean; enabledSources?: Source[];
  jobTimeoutMs?: number; maxConcurrentJobs?: number; limiter?: ScraperJobLimiter;
  sourceOptions?: RealEstateScraper.Query["sourceOptions"];
  browser?: RealEstateScraper.BrowserOptions;
  depth?: DepthOptions; sourceDepth?: Partial<Record<Source, DepthOptions>>;
  factory?: ScraperFactory;
}
const transport: RealEstateScraper.Transport = async request => {
  if (!["GET", "POST"].includes(request.method.toUpperCase())) throw new Error("UNSUPPORTED_METHOD");
  const body = request.data === undefined ? undefined : typeof request.data === "string" ? request.data : JSON.stringify(request.data);
  const response = await scraperHttpRequest(request.url, { method: request.method.toUpperCase() as "GET" | "POST", headers: request.headers, body, signal: request.signal, timeoutMs: request.timeout, maxBytes: 10_000_000 }).catch(error => {
    if (error instanceof Error && error.message === "NETWORK_TIMEOUT_OR_ABORT") throw Object.assign(new Error("TIMEOUT"), { code: request.signal?.aborted ? "ABORTED" : "TIMEOUT" });
    throw error;
  });
  const text = response.data.toString("utf8");
  let data: unknown = text;
  if (/json/iu.test(String(response.headers["content-type"]))) { try { data = JSON.parse(text); } catch { /* Parser reports invalid payload. */ } }
  return { data, status: response.status, url: response.url, headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) };
};
/** Use the public browser lifecycle API to intercept ALL browser network, including subresources. */
export const defaultScraperFactory: ScraperFactory = async config => {
  const { browser, jobDeadlineAt, dateDetailMaxCards, ...provided } = config;
  const deadline = jobDeadlineAt ?? Date.now() + (config.timeout ?? 30000);
  let requestDeadline = deadline;
  const httpConfig = { ...provided, transport: provided.transport ?? transport, maxRetries: 0 };
  if (!browser) return extendSourceParsers(await RealEstateScraper.create(httpConfig), { deadline, maxCards: dateDetailMaxCards });
  const browserOptions = browser === true ? {} : browser;
  // Ordinary Playwright launch: no fingerprint changes or anti-detection scripts.
  const browserInstance = await chromium.launch({ channel: browserOptions.channel, executablePath: browserOptions.executablePath, headless: browserOptions.headless ?? true, timeout: httpConfig.timeout });
  const launched = { browser: browserInstance, close: () => browserInstance.close() };
  try {
    const context: BrowserContext = await launched.browser.newContext({ serviceWorkers: "block", locale: "ru-RU" });
    const browserAbort = new AbortController();
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", async route => {
      const request = route.request();
      try {
        if (!["GET", "POST"].includes(request.method())) { await route.abort(); return; }
        const remaining = Math.min(deadline, requestDeadline) - Date.now();
        if (remaining <= 0 || browserAbort.signal.aborted) { await route.abort(); return; }
        const response = await safeRequest(request.url(), { method: request.method() as "GET" | "POST", headers: request.headers(), body: request.postData() ?? undefined, signal: browserAbort.signal, timeoutMs: Math.min(config.timeout ?? 30000, remaining), maxBytes: 10_000_000, followRedirects: false });
        const headers = Object.fromEntries(Object.entries(response.headers).filter(([key, value]) => value !== undefined && !["content-encoding", "content-length", "transfer-encoding"].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]));
        await route.fulfill({ status: response.status, headers, body: response.data });
      } catch { await route.abort().catch(() => undefined); }
    });
    const sources = browserOptions.sources ?? ["cian", "avito"];
    const sourceConfigs = { ...httpConfig.sourceConfigs };
    const browserTransport = RealEstateScraper.createBrowserTransport({ context, timeout: browserOptions.timeout, settleMs: browserOptions.settleMs, waitForSelector: browserOptions.waitForSelector });
    const guardedBrowserTransport: RealEstateScraper.Transport = async request => {
      requestDeadline = Math.min(deadline, Date.now() + request.timeout);
      if (requestDeadline <= Date.now()) throw Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" });
      const abort = () => browserAbort.abort();
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) abort();
      try { return await (request.method.toUpperCase() !== "GET" && !request.browser ? (httpConfig.transport ?? transport)(request) : browserTransport(request)); }
      finally { request.signal?.removeEventListener("abort", abort); }
    };
    for (const source of sources) sourceConfigs[source] = { ...sourceConfigs[source], transport: resilientTransport(guardedBrowserTransport, source, deadline) };
    const client = extendSourceParsers(new RealEstateScraper({ ...httpConfig, sourceConfigs }));
    return { searchSite: client.searchSite.bind(client), close: launched.close };
  } catch (error) { await launched.close(); throw error; }
};
function positiveInt(value: unknown, fallback: number): number { const number = Number(value ?? fallback); if (!Number.isSafeInteger(number) || number < 1) throw new Error("INVALID_SCRAPER_LIMIT"); return number; }
// Shared process-wide limiter for production adapters; tests may inject an isolated limiter.
let productionLimiter: ScraperJobLimiter | undefined;
export class RealEstateScraperAdapter implements ScraperAdapter {
  private readonly limiter: ScraperJobLimiter;
  private readonly timeout: number;
  constructor(private readonly options: ScraperOptions = {}) {
    const maximum = Math.min(3, positiveInt(options.maxConcurrentJobs ?? process.env.SCRAPER_MAX_CONCURRENT_JOBS, 1));
    this.limiter = options.limiter ?? (options.factory ? new ScraperJobLimiter(maximum) : productionLimiter ??= new ScraperJobLimiter(maximum));
    this.timeout = Math.min(300_000, positiveInt(options.jobTimeoutMs ?? process.env.SCRAPER_JOB_TIMEOUT_MS, 180_000));
  }
  /** Compatibility bridge until application/model adopts v3.1 statuses. */
  async search(input: unknown, context?: { signal?: AbortSignal; deadline?: number }): Promise<SearchResult> {
    const result = await this.searchDetailed(input, context);
    return { ...result, sources: result.sources.map(run => ({ ...run, adapterStatus: run.status,
      status: (["needs_user_action", "rate_limited"].includes(run.status) ? "blocked" : run.status === "parse_failed" ? "error" : run.status === "cancelled" ? "timeout" : run.status) as SourceRun["status"] })) };
  }
  async searchDetailed(input: unknown, context?: { signal?: AbortSignal; deadline?: number }): Promise<AdapterSearchResult> {
    const filters = SearchFilters.parse(input);
    const deadline = Math.min(context?.deadline ?? Infinity, Date.now() + this.timeout);
    const runs = await Promise.all([...new Set(filters.sources)].map(source => this.runSource(source, filters, deadline, context?.signal)));
    const listings = deduplicateListings(runs.flatMap(r => r.listings));
    return { listings: listings.map(listing => ({ listing, evaluation: evaluateListing(listing, filters) })), sources: runs.map(r => r.run) };
  }
  private async runSource(source: Source, filters: SearchFilters, deadline: number, signal?: AbortSignal) {
    const depth = resolveSourceDepth(source, { ...this.options.depth, ...this.options.sourceDepth?.[source] });
    const plan = boundSourceQueries(source, buildScraperQueries(filters, source, new AbortController().signal, this.options.sourceOptions, depth), depth);
    const metadata = { incomplete: true, pagesFetched: 0, listingsFetched: 0, maxPages: plan.maxPages, limit: depth.limit, estimatedRequests: plan.estimatedRequests };
    const host = { cian: "www.cian.ru", avito: "www.avito.ru", domclick: "domclick.ru", yandex: "realty.yandex.ru", mirkvartir: "cre.mirkvartir.ru", onrealt: "onrealt.ru", youla: "youla.ru" }[source];
    const empty = (status: AdapterSourceRun["status"], reason: string) => ({ run: { source, status, resultCount: 0, reason, ...metadata, ...(status === "needs_user_action" ? { actionUrl: `https://${host}/` } : {}) } satisfies AdapterSourceRun, listings: [] as ReturnType<typeof normalizeListing>[] });
    if (signal?.aborted) return empty("cancelled", "Поиск отменён");
    if (!(this.options.enabled ?? process.env.SCRAPER_ENABLED === "true") || this.options.enabledSources && !this.options.enabledSources.includes(source)) return empty("disabled", "Источник отключён");
    for (const query of plan.queries) {
      const geo = resolveSourceGeography({ ...filters, city: query.city ?? filters.city, locations: undefined }, source, this.options.sourceOptions);
      if (source === "cian" && !geo.regionId && !geo.url) return empty("unsupported_filter", "Для выбранной локации нет проверенного идентификатора Циан. Выберите другую площадку.");
      if (source === "avito" && !geo.locationId && !geo.url || source === "domclick" && !geo.address && !geo.url) return empty("unsupported_filter", `Фильтр city: требуется sourceOptions.${source}.${source === "avito" ? "locationId" : "address"}`);
    }
    const geography = resolveSourceGeography(filters, source, this.options.sourceOptions);
    const missingGeography = source === "domclick" && !geography?.address && !geography?.params?.address ? "address" : source === "avito" && !geography?.locationId ? "locationId" : source === "mirkvartir" && !geography?.locationIds ? "locationIds" : null;
    if (missingGeography && !geography?.url) return empty("unsupported_filter", `Фильтр city: требуется sourceOptions.${source}.${missingGeography}`);
    return this.limiter.run(async () => {
      // Queue time belongs to the job deadline too. Never start a new network
      // request after an earlier source consumed the entire job's budget.
      const remaining = deadline - Date.now();
      if (remaining <= 0) return empty("timeout", "Превышен срок выполнения задания");
      if (signal?.aborted) return empty("cancelled", "Поиск отменён");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let client: ScraperClient | undefined;
      let partial: RealEstateScraper.SearchResult | undefined;
      const batches: RealEstateScraper.SearchResult[] = [];
      let finished = false;
      let stopCode: "ABORTED" | "TIMEOUT" | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const browserEnabled = this.options.browserEnabled ?? process.env.SCRAPER_BROWSER_ENABLED !== "false";
      const factory = this.options.factory ?? defaultScraperFactory;
      const parallelHousing = ["mirkvartir", "onrealt"].includes(source) && plan.queries.length > 1;
      const work = async () => {
        const created = await factory({ timeout: Math.min(remaining, 30_000), jobDeadlineAt: deadline, dateDetailMaxCards: parallelHousing ? 0 : undefined, maxRetries: 0, transport: resilientTransport(transport, source, deadline, 1000),
          ...(browserEnabled && ["cian", "avito"].includes(source) ? { browser: { channel: "chrome",
            ...(process.env.SCRAPER_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.SCRAPER_BROWSER_EXECUTABLE_PATH } : {}),
            ...this.options.browser, sources: [source] } } : {}) });
        if (controller.signal.aborted || finished) { await created.close(); throw { code: "ABORTED" }; }
        client = created;
        // Mixed commercial+residential selections query both categories; single-category searches keep one request.
        // Жилая раскрыта в 6 однотипных запросов: площадки поддерживают не все типы жилья,
        // поэтому ветви выполняются изолированно — успех одних сохраняется при отказе других.
        const queries = plan.queries.map(query => ({ ...query, signal: controller.signal }));
        const merged = await (async (): Promise<RealEstateScraper.SearchResult> => {
          let acc: RealEstateScraper.SearchResult | undefined;
          let cursor = 0;
          let accessStopped = false;
          const worker = async () => {
            while (cursor < queries.length && !accessStopped) {
              const branchIndex = cursor++;
              const query = queries[branchIndex]!;
              if (controller.signal.aborted || Date.now() >= deadline) { controller.abort(); break; }
              try {
                const next = await created.searchSite(source, query);
                if (finished) break;
                batches[branchIndex] = next;
                if (next.errors.some(error => ["NEEDS_USER_ACTION", "ACCESS_BLOCKED", "RATE_LIMITED"].includes(error.code ?? ""))) accessStopped = true;
                if (!acc) acc = { ...next, results: [...next.results], pages: [...next.pages], errors: [...next.errors] };
                else { acc.results.push(...next.results); acc.pages.push(...next.pages); acc.errors.push(...next.errors); acc.total += next.total; acc.partial = acc.partial || next.partial; }
              } catch (branch) {
                if (finished) break;
                const info = branch && typeof branch === "object" ? branch as { code?: string; message?: string; status?: number; url?: string } : {};
                if (["NEEDS_USER_ACTION", "ACCESS_BLOCKED", "RATE_LIMITED"].includes(info.code ?? "")) accessStopped = true;
                const entry = { source, page: 1, code: typeof info.code === "string" ? info.code : "SEARCH_FAILED",
                  error: typeof info.message === "string" && info.message ? info.message : String(branch),
                  ...(info.status !== undefined ? { status: info.status } : {}),
                  ...(query.type ? { types: [query.type as RealEstateScraper.PropertyType] } : {}) };
                if (!acc) acc = { query, timestamp: new Date().toISOString(), total: 0, results: [], errors: [entry], pages: [], partial: false };
                else { acc.errors.push(entry); acc.partial = true; }
              }
              // Publish at every branch boundary: a later hung call must not erase it.
              partial = acc;
              if (Date.now() >= deadline) controller.abort();
            }
          };
          // Flat/studio come first in the plan; two workers bound in-flight work.
          await Promise.all(Array.from({ length: parallelHousing ? 2 : 1 }, () => worker()));
          if (!acc) throw { code: "ABORTED" };
          return acc;
        })();
        return merged;
      };
      try {
        // Install cancellation before starting work, including a slow factory.
        const stopped = new Promise<RealEstateScraper.SearchResult>((resolve, reject) => {
          const stop = () => {
            if (finished) return;
            stopCode = signal?.aborted ? "ABORTED" : "TIMEOUT";
            // Give the page-accumulating parser a bounded chance to return its tail.
            graceTimer = setTimeout(() => partial ? resolve(partial) : reject({ code: stopCode }), 20);
          };
          controller.signal.addEventListener("abort", stop, { once: true });
          timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
          if (signal?.aborted) controller.abort();
        });
        const result = await Promise.race([stopped, work()]);
        finished = true;
        let invalid = 0;
        const normalized = batches.filter(Boolean).map(batch => batch.results.flatMap(raw => {
          try { if (raw.source !== source) throw new Error("SOURCE_MISMATCH"); return [normalizeListing(raw, batch.timestamp)]; }
          catch { invalid++; return []; }
        }));
        // Round-robin selection keeps later housing types represented even when
        // a client over-returns or the source allowance is smaller than fanout.
        const interleaved: ReturnType<typeof normalizeListing>[] = [];
        for (let row = 0; row < Math.max(0, ...normalized.map(batch => batch.length)); row++) {
          for (const batch of normalized) if (batch[row]) interleaved.push(batch[row]!);
        }
        const unique = deduplicateListings(interleaved);
        const listings = unique.slice(0, depth.limit);
        const resultLimited = unique.length > depth.limit;
        const successfulPage = result.pages.some(p => p.errors.length === 0);
        const errors = result.errors.map(e => e.code === "ABORTED" && !signal?.aborted ? { ...e, code: "TIMEOUT" } : e);
        if (stopCode) errors.push({ source, page: result.pages.length + 1, code: stopCode, error: "" });
        const status: AdapterSourceRun["status"] = errors.length ? successfulPage || listings.length ? "partial" : failure(errors) : invalid || result.partial ? "partial" : "success";
        const branchTails = new Map<string, RealEstateScraper.PageMetadata>();
        for (const page of result.pages) branchTails.set(JSON.stringify(page.types ?? []), page);
        const limited = resultLimited || [...branchTails.values()].some(p => p.hasNext === true || p.truncated);
        const dateDetails = client && dateEnrichmentProgress(client, source);
        const detailReason = dateDetails ? `Даты карточек: запросов ${dateDetails.requested}/${dateDetails.limit}, кеш ${dateDetails.cacheHits}, найдено ${dateDetails.enriched}, ошибок ${dateDetails.failed}` : null;
        const unsupportedHousing = [...new Set(errors.filter(e => ["UNSUPPORTED_FILTER", "NOT_APPLICABLE", "LOCATION_REQUIRED"].includes(e.code ?? "")).flatMap(e => e.types ?? []))];
        const housingCoverage = (filters.purposes as string[]).includes("residential") && unsupportedHousing.length && (successfulPage || listings.length)
          ? `Жилая: площадка не предлагает типы ${unsupportedHousing.join(", ")}; остальные варианты сохранены` : null;
        return { listings, run: { source, status, resultCount: listings.length, ...metadata,
          ...(dateDetails ? { dateDetails: { ...dateDetails } } : {}),
          pagesFetched: result.pages.filter(p => !p.errors.length).length, listingsFetched: result.results.length,
          ...(errors[0] ? { failureCode: errors[0].code } : {}),
          incomplete: limited || !!errors.length || invalid > 0 || result.partial || result.pages.some(p => p.hasNext === null),
          ...(errors.some(e => e.code === "NEEDS_USER_ACTION") ? { actionUrl: `https://${host}/` } : {}),
          reason: [(filters.purposes as string[]).includes("residential") && filters.purposes.some(p => p !== "residential") ? "Смешанный поиск: категории commercial + residential; назначение проверяется CRM" : null, source === "onrealt" && filters.purposes.includes("retail") ? "Торговля: используется категория ПСН OnRealt; назначение проверяется CRM, охват неполный" : null, housingCoverage, errors.length ? errors.map(e => `${source}: ${scraperErrorReason(e)}`).join("; ") : invalid ? `Некорректные записи: ${invalid}` : limited ? "Достигнут лимит страниц/карточек; сортировка по дате площадкой не гарантирована" : null, detailReason].filter(Boolean).join("; ") || null } satisfies AdapterSourceRun };
      } catch (error) {
        const info = error && typeof error === "object" ? error as { code?: string; status?: number } : {};
        const stopped = stopCode ? { code: stopCode } : info;
        return empty(failure([stopped]), `${source}: ${scraperErrorReason(stopped)}`);
      } finally {
        finished = true;
        if (graceTimer) clearTimeout(graceTimer);
        signal?.removeEventListener("abort", abort);
        if (timer) clearTimeout(timer);
        controller.abort();
        // close() is idempotent; race bounds cleanup even for faulty injected clients.
        if (client) { let cleanupTimer: ReturnType<typeof setTimeout> | undefined; await Promise.race([client.close().catch(() => undefined), new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000); })]); if (cleanupTimer) clearTimeout(cleanupTimer); }
      }
    }, { signal, deadline }).catch(error => {
      const info = error as { code?: string };
      return empty(failure([info]), `${source}: ${scraperErrorReason(info)}`);
    });
  }
}
