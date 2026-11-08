import { describe, it, expect, vi, afterEach } from "vitest";
const state = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock("@/shared/db/client", () => ({ db: {} }));
vi.mock("@/modules/property-search/infrastructure/scraper-adapter", () => ({
  RealEstateScraperAdapter: class { constructor(options: unknown) { state.options = options; } },
}));
vi.mock("@/modules/property-search/application/fixture-scraper", () => ({ FixtureScraperAdapter: class {} }));
vi.mock("@/modules/ai/application/credentials-service", () => ({ aiCredentialsService: () => ({ resolve: async () => ({ credentials: null }) }) }));
vi.mock("@/modules/ai/application/persistent-search-ai", () => ({ createPersistentSearchAi: async () => {
  const { ConflictError } = await import("@/shared/errors");
  throw new ConflictError("AI_CREDENTIALS_MISSING", "Требуется подключение Яндекс AI", { settingsUrl: "/settings/ai" });
} }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ AI_ENABLED: true, SCRAPER_DEMO_FIXTURES: false }) }));
import { getSearchAi, scraperFor, type searchSettings } from "@/modules/property-search/application/dependencies";

afterEach(() => { state.options = undefined; });
describe("local backend composition", () => {
  it("passes all seven authorized sources and the bundled executable directly into the Node adapter", () => {
    const sources = ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"];
    const settings = { enabled: true, sources, settings: { browserEnabled: true },
      config: { SCRAPER_BROWSER_ENABLED: true, SCRAPER_CHROME_PATH: "D:\\synthetic-bundle\\chrome.exe", SCRAPER_JOB_TIMEOUT_MS: 12345, SCRAPER_MAX_CONCURRENT_JOBS: 1 } } as Awaited<ReturnType<typeof searchSettings>>;
    scraperFor(settings);
    expect(state.options).toEqual({ enabled: true, enabledSources: sources, browserEnabled: true,
      browser: { executablePath: "D:\\synthetic-bundle\\chrome.exe" }, jobTimeoutMs: 12345, maxConcurrentJobs: 1 });
    scraperFor({ ...settings, enabled: false, settings: { ...settings.settings!, browserEnabled: false } });
    expect(state.options).toMatchObject({ enabled: false, browserEnabled: false });
  });
  it("does not fail scraper composition or reserve/spend when optional credentials are missing", async () => {
    const ai = await getSearchAi(); expect(ai).not.toBeNull();
    expect(ai?.configured).toBe(false);
    // Actual missing-provider methods fail with fixed metadata, not adapter errors.
    await expect(ai!.assertConfigured!())
      .rejects.toMatchObject({ code: "AI_CREDENTIALS_MISSING", message: "Требуется подключение Яндекс AI", details: { settingsUrl: "/settings/ai" } });
    await expect(ai!.checkWebSearchAvailability({ user: { userId: "synthetic", active: true }, jobId: "synthetic", ownerUserId: "synthetic", requestId: "synthetic" }, {}))
      .resolves.toEqual({ budgetAvailable: false, limitAvailable: false });
  });
});
