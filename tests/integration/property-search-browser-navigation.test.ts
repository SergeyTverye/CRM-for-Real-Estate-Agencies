import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { enqueueSearch, processSearchQueue } from "@/modules/property-search/application/search-queue";
import { getSearchRun } from "@/modules/property-search/application/search-service";
import { resetConfigCache } from "@/shared/config/env";

const state = vi.hoisted(() => ({ challenge: false, navigations: [] as string[], profiles: [] as string[], closes: 0 }));
vi.mock("@/modules/property-search/infrastructure/browser-navigation", async importOriginal => {
  const actual = await importOriginal<typeof import("@/modules/property-search/infrastructure/browser-navigation")>();
  return { ...actual, headedBrowserAvailable: () => true,
    createBrowserNavigation: (options: Parameters<typeof actual.createBrowserNavigation>[0]) => actual.createBrowserNavigation({ ...options, settleMs: 0, open: async profile => {
      state.profiles.push(profile);
      let url = "about:blank";
      const page = { url: () => url, on: () => {}, off: () => {}, goto: async (target: string) => { state.navigations.push(target); url = target; }, content: async () => state.challenge ? "<h1>Подтвердите, что вы человек</h1>" : options.source === "yandex"
        ? '<div data-test="OfferCard"><a href="https://realty.yandex.ru/offer/987654321/"><span data-test="OfferCardTitle">Офис 80 м²</span></a><span data-test="Price">80000 ₽ в месяц</span><span data-test="Address">Новосибирск, Синтетическая улица, 1</span></div>'
        : '<article data-name="OfferCard"><a href="https://novosibirsk.cian.ru/rent/commercial/987654321/"><h2>Офис 80 м²</h2></a><span data-mark="MainPrice">80000 ₽ в месяц</span><span data-name="GeoLabel">Новосибирск, Синтетическая улица, 1</span></article>' };
      return { pages: () => [page], newCDPSession: async () => ({ send: async () => {}, on: () => {} }), close: async () => { state.closes++; }, clearPermissions: async () => {}, routeWebSocket: async () => {}, on: () => {} } as never;
    } }) };
});

let users: TestUsers;
beforeEach(async () => {
  vi.stubEnv("SCRAPER_ENABLED", "true"); vi.stubEnv("SCRAPER_BROWSER_ENABLED", "true"); vi.stubEnv("SCRAPER_DEMO_FIXTURES", "false");
  resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { scraperEnabled: true, browserEnabled: true, enabledSources: ["cian", "yandex"], cianAutoBrowser: true, yandexAutoBrowser: true } });
  state.challenge = false; state.navigations = []; state.profiles = []; state.closes = 0;
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigCache(); });

it.each([false, true])("fake browser → production parser/queue/status/persistence; challenge=%s (PG and SQLite)", async challenge => {
  state.challenge = challenge;
  const run = await enqueueSearch(users.realtor1, { filters: { operation: "rent", priceUnit: "rub_month", purposes: ["office"] }, sources: ["cian", "yandex"], depth: { maxPages: 1, limit: 5 }, idempotencyKey: `browser-native-${challenge}` });
  expect(await processSearchQueue()).toBe(true);
  const saved = await getSearchRun(users.realtor1, run.id);
  expect(saved.status).toBe(challenge ? "needs_user_action" : "completed");
  expect(saved.sources).toHaveLength(2);
  for (const source of saved.sources) expect(source).toMatchObject({ status: challenge ? "needs_user_action" : "success", needsUserAction: challenge, resultCount: challenge ? 0 : 1 });
  expect(saved.results).toHaveLength(challenge ? 0 : 2);
  expect(state.navigations).toHaveLength(2); expect(state.closes).toBe(2);
  await expect(getSearchRun(users.realtor2, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
