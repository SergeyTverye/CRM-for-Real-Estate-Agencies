import type { SearchAi } from "@/modules/ai/infrastructure/search-ai";
import type { ScraperAdapter } from "../infrastructure/scraper-adapter";
import { RealEstateScraperAdapter } from "../infrastructure/scraper-adapter";
import { FixtureScraperAdapter } from "./fixture-scraper";
import { getConfig } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { SOURCES, type Source } from "../domain/types";

export type SearchAiPort = Pick<SearchAi, "parseSearchQuery" | "analyzeDescriptions" | "webSearch" | "checkWebSearchAvailability">;
// Composition seam: a persistent AiGate-backed factory can be installed by the AI module.
let aiFactory: (() => Promise<SearchAiPort | null>) | undefined;
export function configureSearchAi(factory: () => Promise<SearchAiPort | null>) { aiFactory = factory; }
export async function getSearchAi(): Promise<SearchAiPort | null> {
  const config = getConfig();
  if (!config.AI_ENABLED) return null;
  if (aiFactory) return aiFactory();
  if (config.SCRAPER_DEMO_FIXTURES) {
    const { createDemoSearchAi } = await import("./demo-ai");
    return createDemoSearchAi(config);
  }
  const { createPersistentSearchAi } = await import("@/modules/ai/application/persistent-search-ai");
  return createPersistentSearchAi();
}
export async function searchSettings() {
  const config = getConfig();
  const settings = await db.aiSetting.findFirst();
  return { config, settings, enabled: config.SCRAPER_ENABLED && !!settings?.scraperEnabled,
    sources: (settings?.enabledSources ?? []).filter((s): s is Source => SOURCES.includes(s as Source)),
    aiEnabled: config.AI_ENABLED && !!settings?.aiEnabled,
    manualAllowed: config.YANDEX_WEB_SEARCH_ENABLED && !!settings?.webSearchManualAllowed,
    autoFallback: config.YANDEX_WEB_SEARCH_AUTO_FALLBACK && !!settings?.webSearchAutoFallback };
}
export function scraperFor(settings: Awaited<ReturnType<typeof searchSettings>>, scenario = "success", depthOptions: Pick<import("../infrastructure/scraper-adapter").ScraperOptions, "depth" | "sourceDepth"> = {}): ScraperAdapter {
  const options = { enabled: settings.enabled, enabledSources: settings.sources,
    browserEnabled: settings.config.SCRAPER_BROWSER_ENABLED && !!settings.settings?.browserEnabled,
    jobTimeoutMs: settings.config.SCRAPER_JOB_TIMEOUT_MS, maxConcurrentJobs: settings.config.SCRAPER_MAX_CONCURRENT_JOBS, ...depthOptions };
  return settings.config.SCRAPER_DEMO_FIXTURES ? new FixtureScraperAdapter(options, scenario, "tests/fixtures/scraper/demo-novosibirsk") : new RealEstateScraperAdapter(options);
}
