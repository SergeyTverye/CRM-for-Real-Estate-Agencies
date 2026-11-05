import type RealEstateScraper from "real-estate-scrapper";
import { extractListingDates } from "./listing-dates";
import { detectAccessChallenge } from "./source-response";

/** Extend the installed parsers in our adapter, without patching node_modules. */
export function extendSourceParsers(client: RealEstateScraper): RealEstateScraper {
  for (const parser of Object.values(client.parsers)) {
    const fetch = parser.fetch.bind(parser), searchPage = parser.searchPage.bind(parser), parse = parser.parsePage.bind(parser);
    let documents: { payload: unknown; fetchedAt: string }[] = [];
    parser.fetch = async (url, options) => {
      try {
        const response = await fetch(url, options);
        const payload = response && typeof response === "object" && "data" in response ? response.data : response;
        if (detectAccessChallenge(url, payload)) throw Object.assign(new Error("NEEDS_USER_ACTION"), { code: "NEEDS_USER_ACTION", url: `https://${new URL(url).hostname}/` });
        documents.push({ payload, fetchedAt: new Date().toISOString() });
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
    parser.searchPage = async query => {
      documents = [];
      const page = await searchPage(query);
      page.results = page.results.map(raw => {
        let fields = extractListingDates(raw.source, raw, { id: raw.parentId ?? raw.id, url: raw.url }, raw.timestamp);
        for (const document of documents) {
          const dates = extractListingDates(raw.source, document.payload, { id: raw.parentId ?? raw.id, url: raw.url }, document.fetchedAt);
          if (dates.publishedAt || dates.sourceUpdatedAt) fields = { ...dates, publishedAt: dates.publishedAt ?? fields.publishedAt, sourceUpdatedAt: dates.sourceUpdatedAt ?? fields.sourceUpdatedAt };
        }
        return { ...raw, ...fields };
      });
      documents = [];
      return page;
    };
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
