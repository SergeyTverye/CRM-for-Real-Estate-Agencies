import { readFile } from "node:fs/promises";
import path from "node:path";
import type RealEstateScraper from "real-estate-scrapper";
import { SearchFilters, type SearchResult } from "../domain/types";
import { normalizeListing, deduplicateListings } from "../infrastructure/normalization";
import { evaluateListing } from "../domain/evaluation";
import type { ScraperAdapter, ScraperOptions } from "../infrastructure/scraper-adapter";

/** No network requests; fixtures are synthetic, recorded parser outputs. */
export class FixtureScraperAdapter implements ScraperAdapter {
  private firstSource?: string;
  constructor(private options: ScraperOptions, private scenario = "success", private fixtureDirectory = "tests/fixtures/scraper") {}
  async search(raw: unknown): Promise<SearchResult> {
    const filters = SearchFilters.parse(raw);
    this.firstSource ??= filters.sources[0];
    const listings = [] as ReturnType<typeof normalizeListing>[];
    const sources: SearchResult["sources"] = [];
    for (const source of filters.sources) {
      if (!this.options.enabled || !this.options.enabledSources?.includes(source)) {
        sources.push({ source, status: "disabled", resultCount: 0, reason: "Источник отключён" }); continue;
      }
      if (this.scenario === "failure" || this.scenario === "partial" && source !== this.firstSource) {
        sources.push({ source, status: "blocked", resultCount: 0, reason: "Записанный ответ: HTTP 429" }); continue;
      }
      const fixture = JSON.parse(await readFile(path.join(process.cwd(), this.fixtureDirectory, `${source}.json`), "utf8")) as { results: RealEstateScraper.Listing[] };
      const rows = this.scenario === "empty" ? [] : fixture.results.map(row => normalizeListing(row, new Date().toISOString()));
      listings.push(...rows);
      sources.push({ source, status: "success", resultCount: rows.length, reason: "Записанный ответ площадки" });
    }
    return { sources, listings: deduplicateListings(listings).map(listing => ({ listing, evaluation: evaluateListing(listing, filters) })) };
  }
}
