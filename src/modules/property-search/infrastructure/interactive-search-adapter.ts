import RealEstateScraper from "real-estate-scrapper";
import type { InteractiveSearchAdapter } from "../application/browser-continuation";
import type { SessionSource } from "@/modules/browser-sessions/domain/session";
import { allowsStart } from "@/modules/browser-sessions/infrastructure/network-policy";
import { ConflictError } from "@/shared/errors";
import type { SearchFilters } from "../domain/types";
import { buildScraperQuery } from "./source-filters";
import { normalizeListing, deduplicateListings } from "./normalization";
import { detectAccessChallenge } from "./source-response";
import { extractListingDates } from "./listing-dates";
import { resolveSourceDepth, type DepthOptions } from "./source-limits";

/** No browser/network is created by the parser. All navigation uses the guarded HITL page.
 * Enabling a source is an operator assertion of permission, not an anti-bot bypass. */
export class ProductionInteractiveSearchAdapter implements InteractiveSearchAdapter {
  constructor(private readonly allowed: () => readonly string[] = () => (process.env.BROWSER_SESSION_ALLOWED_SOURCES ?? "").split(",").map(s => s.trim())) {}
  private assertAllowed(source: SessionSource) {
    if (!this.allowed().includes(source)) throw new ConflictError("SOURCE_CONTINUATION_NOT_ALLOWED", "Продолжение для площадки не разрешено. Используйте добавление по ссылке или официальную выгрузку.");
  }
  async prepare(filters: SearchFilters, source: SessionSource, depth?: DepthOptions) {
    this.assertAllowed(source);
    const query = buildScraperQuery(filters, source, new AbortController().signal, undefined, depth);
    const parser = new RealEstateScraper({ maxRetries: 0 }).parsers[source];
    // Native multi-type sources preserve OR; other parsers may support only one branch.
    const startUrl = parser.buildSearchUrl(query);
    if (!allowsStart(source, startUrl)) throw new Error("INVALID_CONTINUATION_URL");
    return { startUrl, parameters: { query: { ...query, signal: undefined }, startUrl, source, depth: resolveSourceDepth(source, depth) } };
  }
  async isReady(page: Parameters<InteractiveSearchAdapter["isReady"]>[0], source: SessionSource) {
    this.assertAllowed(source);
    if (!allowsStart(source, page.url())) return false;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      const html = await page.content();
      if (detectAccessChallenge(page.url(), html) || html.length > 8_000_000) return false;
      const parsed = new RealEstateScraper({ maxRetries: 0 }).parsers[source].parsePage(html, page.url(), { page: 1 });
      return parsed.results.length > 0 || parsed.sourceTotal === 0;
    } catch { return false; }
  }
  async collect(input: Parameters<InteractiveSearchAdapter["collect"]>[0]) {
    this.assertAllowed(input.source);
    const params = input.parameters as { query: RealEstateScraper.Query; startUrl: string; source: SessionSource; depth: DepthOptions };
    if (params.source !== input.source || input.page.context() !== input.context || !allowsStart(input.source, params.startUrl)) throw new Error("INVALID_CONTINUATION_CONTEXT");
    const parser = new RealEstateScraper({ maxRetries: 0 }).parsers[input.source];
    const depth = resolveSourceDepth(input.source, params.depth);
    const listings: ReturnType<typeof normalizeListing>[] = [];
    const visited = new Set<string>();
    let depthReached = 0, incomplete = false, blocked = false;
    for (let index = 1; index <= depth.maxPages; index++) {
      input.signal.throwIfAborted();
      const url = input.page.url();
      if (!allowsStart(input.source, url) || visited.has(url)) { blocked = true; break; }
      visited.add(url);
      const html = await input.page.content();
      if (html.length > 8_000_000 || detectAccessChallenge(url, html)) { blocked = true; break; }
      let parsed: ReturnType<typeof parser.parsePage>;
      try { parsed = parser.parsePage(html, url, { ...params.query, page: index, signal: input.signal }); }
      catch { blocked = true; break; }
      if (!parsed.results.length && parsed.sourceTotal !== 0) { blocked = true; break; }
      depthReached++;
      const fetchedAt = new Date().toISOString();
      for (const raw of parsed.results) {
        if (raw.source !== input.source) { incomplete = true; continue; }
        try {
          const dates = extractListingDates(input.source, html, { id: raw.parentId ?? raw.id, url: raw.url }, fetchedAt);
          listings.push(normalizeListing({ ...raw, ...dates }, fetchedAt));
        } catch { incomplete = true; }
        if (listings.length >= depth.limit) break;
      }
      if (!parsed.hasNext) break;
      if (index >= depth.maxPages || listings.length >= depth.limit) { incomplete = true; break; }
      const next = parsed.nextUrl && new URL(parsed.nextUrl, url).toString();
      if (!next || !allowsStart(input.source, next)) { incomplete = true; break; }
      // Same page, cookies and network policy. No retries after a repeated challenge.
      const response = await input.page.goto(next, { waitUntil: "domcontentloaded" });
      if (response && [401, 403, 429, 439].includes(response.status())) { blocked = true; break; }
    }
    input.signal.throwIfAborted();
    return { listings: deduplicateListings(listings), blocked, depthReached, incomplete: incomplete || blocked };
  }
}
