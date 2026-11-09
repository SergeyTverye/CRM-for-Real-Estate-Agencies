import { attachGeographyParsers } from "./geography-parsers";
import { AsyncLocalStorage } from "node:async_hooks";
import type RealEstateScraper from "real-estate-scrapper";
import { attachYoulaParser } from "./youla-parser";
import { attachResidentialParsers } from "./residential-parsers";
import { extractListingDates } from "./listing-dates";
import { detectAccessChallenge } from "./source-response";
import { DateEnrichment, type DateDetailOptions, type DateDetailProgress } from "./date-enrichment";
import type { Source } from "../domain/types";
import { cardQuality, listingQuality } from "./listing-quality";

const detailProgress = new WeakMap<RealEstateScraper, Partial<Record<Source, DateDetailProgress>>>();
export function dateEnrichmentProgress(client: object, source: Source) { return detailProgress.get(client as RealEstateScraper)?.[source]; }

/** Extend the installed parsers in our adapter, without patching node_modules. */
export function extendSourceParsers(client: RealEstateScraper, options: DateDetailOptions = {}): RealEstateScraper {
  attachResidentialParsers(client);
  attachGeographyParsers(client);
  attachYoulaParser(client, options);
  const progress: Partial<Record<Source, DateDetailProgress>> = {};
  detailProgress.set(client, progress);
  for (const [source, parser] of Object.entries(client.parsers)) {
    const details = new DateEnrichment(options);
    if (["onrealt", "mirkvartir"].includes(source)) progress[source as Source] = details.progress;
    const fetch = parser.fetch.bind(parser), searchPage = parser.searchPage.bind(parser), parse = parser.parsePage.bind(parser);
    const documents = new AsyncLocalStorage<{ payload: unknown; fetchedAt: string }[]>();
    parser.fetch = async (url, options) => {
      try {
        const response = await fetch(url, options);
        const payload = response && typeof response === "object" && "data" in response ? response.data : response;
        if (detectAccessChallenge(url, payload)) throw Object.assign(new Error("NEEDS_USER_ACTION"), { code: "NEEDS_USER_ACTION", url: `https://${new URL(url).hostname}/` });
        documents.getStore()?.push({ payload, fetchedAt: new Date().toISOString() });
        return response;
      } catch (error) {
        const e = error as { cause?: { code?: string }; code?: string };
        if (["NEEDS_USER_ACTION", "RATE_LIMITED", "TIMEOUT"].includes(e.cause?.code ?? "")) e.code = e.cause!.code;
        throw error;
      }
    };
    parser.parsePage = (payload, url, query) => {
      if (detectAccessChallenge(url, payload)) throw Object.assign(new Error("NEEDS_USER_ACTION"), { code: "NEEDS_USER_ACTION", url: `https://${new URL(url).hostname}/` });
      return parse(payload, url, query);
    };
    parser.searchPage = async query => documents.run([], async () => {
      const page = await searchPage(query);
      // The package applies query.limit after this hook. Do not repeatedly parse
      // the entire SERP for dozens of cards that it will immediately discard.
      const selectedCount = Math.min(page.results.length, query?.limit ?? page.results.length);
      page.results = page.results.map((raw, index) => {
        if (index >= selectedCount) return raw;
        let fields = extractListingDates(raw.source, raw, { id: raw.parentId ?? raw.id, url: raw.url }, raw.timestamp);
        for (const document of documents.getStore() ?? []) {
          const dates = extractListingDates(raw.source, document.payload, { id: raw.parentId ?? raw.id, url: raw.url }, document.fetchedAt);
          if (dates.publishedAt || dates.sourceUpdatedAt) fields = { ...dates, publishedAt: dates.publishedAt ?? fields.publishedAt, sourceUpdatedAt: dates.sourceUpdatedAt ?? fields.sourceUpdatedAt };
        }
        let quality = listingQuality(raw);
        for (const document of documents.getStore() ?? []) {
          const card = cardQuality(document.payload, raw, (parser as unknown as { selectors?: { card?: string } }).selectors?.card);
          quality = { ...quality, ...Object.fromEntries(Object.entries(card).filter(([, value]) => value !== null)) };
        }
        return { ...raw, ...fields, rooms: quality.rooms ?? raw.rooms,
          ...(quality.priceUnit ? { priceText: quality.priceUnit === "rub_m2_year" ? "₽/м² в год" : quality.priceUnit === "rub_m2_month" ? "₽/м² в месяц" : quality.priceUnit === "rub_year" ? "₽ в год" : "₽ в месяц" } : {}),
          ...(quality.rentalPeriod === "day" ? { priceText: "₽ за сутки" } : {}),
          ...(quality.apartments ? { isApartments: true } : {}) };
      });
      // At most N detail GETs per source/job, shared deadline, date-only TTL cache.
      for (let index = 0; index < selectedCount; index++) {
        const raw = page.results[index]!;
        if ((raw as typeof raw & { publishedAt?: string | null }).publishedAt) continue;
        const dates = await details.read(raw.source, { id: raw.id, url: raw.url }, signal => fetch(raw.url, { signal }), query?.signal);
        if (dates?.publishedAt || dates?.sourceUpdatedAt) page.results[index] = { ...raw, ...dates };
      }
      return page;
    });
  }
  // The package loses previous pages on abort. Accumulate at the page boundary.
  client.searchSite = async (source, query = {}) => {
    const results: RealEstateScraper.Listing[] = [], pages: RealEstateScraper.PageMetadata[] = [], errors: RealEstateScraper.SearchError[] = [];
    try {
      for await (const page of client.searchPages({ ...query, sources: [source] })) {
        results.push(...page.results); errors.push(...page.errors);
        const { results: omitted, ...metadata } = page;
        void omitted; pages.push(metadata);
      }
    } catch (e) {
      const error = e as { code?: string; status?: number };
      errors.push({ source, page: pages.length + 1, code: query.signal?.aborted ? "ABORTED" : error.code ?? "SEARCH_FAILED", status: error.status, error: "" });
    }
    return { source, query, results, pages, errors, total: results.length, timestamp: new Date().toISOString(), partial: errors.length > 0 && results.length > 0 };
  };
  return client;
}
