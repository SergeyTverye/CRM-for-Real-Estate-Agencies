import { describe, it, expect, vi } from "vitest";

describe("desktop search feature ceilings", () => {
  it("allows persisted opt-in without raising spend ceilings, preserving explicit switches", async () => {
    vi.stubEnv("LOCALAPPDATA", "D:\\synthetic-runtime");
    try {
      const { configureSearchRuntime } = await import("../../../scripts/desktop/runtime/supervisor.mjs");
      const env: Record<string, string | undefined> = { AI_ENABLED: "false", YANDEX_WEB_SEARCH_AUTO_FALLBACK: "false", YANDEX_AI_MAX_MONTHLY_COST_RUB: "1", YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB: "0" };
      configureSearchRuntime(env);
      expect(env).toEqual({ AI_ENABLED: "false", SCRAPER_ENABLED: "true", YANDEX_WEB_SEARCH_ENABLED: "true", YANDEX_WEB_SEARCH_AUTO_FALLBACK: "false", YANDEX_AI_MAX_MONTHLY_COST_RUB: "1", YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB: "0" });
      configureSearchRuntime(env); expect(env.AI_ENABLED).toBe("false");
    } finally { vi.unstubAllEnvs(); }
  });
});
