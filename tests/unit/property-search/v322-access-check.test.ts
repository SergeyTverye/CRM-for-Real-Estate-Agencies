import type RealEstateScraper from "real-estate-scrapper";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAccessChallenge, resilientTransport } from "@/modules/property-search/infrastructure/source-response";
import { RealEstateScraperAdapter, defaultScraperFactory } from "@/modules/property-search/infrastructure/scraper-adapter";

const replay = readFileSync("tests/fixtures/scraper/v322/cian-servicepipe-check.html", "utf8");
afterEach(() => vi.useRealTimers());

describe("Cian Servicepipe HTTP 200 structural replay", () => {
  it("recognizes the JS check without a title, form or captcha text", () => {
    expect(detectAccessChallenge("https://novosibirsk.cian.ru/cat.php/", replay)).toBe(true);
    expect(detectAccessChallenge("https://example.org/", replay)).toBe(false);
    expect(detectAccessChallenge("https://www.cian.ru/", '<script src="https://servicepipe.tech/loaders/a.js"></script>')).toBe(false);
    expect(detectAccessChallenge("https://www.cian.ru/", replay + '<div data-name="OfferCard">listing</div>')).toBe(false);
  });
  it("returns needs_user_action and a safe Russian reason, stops remaining housing branches", async () => {
    const transport = vi.fn(async () => ({ status: 200, data: replay }));
    const result = await new RealEstateScraperAdapter({ enabled: true, browserEnabled: false,
      factory: config => defaultScraperFactory({ ...config, transport }),
    }).searchDetailed({ city: "Новосибирск", operation: "sale", purposes: ["residential"], sources: ["cian"] });
    expect(transport).toHaveBeenCalledOnce();
    expect(result.sources[0]).toMatchObject({ status: "needs_user_action", failureCode: "NEEDS_USER_ACTION", resultCount: 0 });
    expect(result.sources[0]?.reason).toContain("проверки браузера/CAPTCHA");
    expect(result.sources[0]?.actionUrl).toBe("https://www.cian.ru/");
    expect(result.listings).toEqual([]);
  });
});

describe("polite concurrent transport", () => {
  it("spaces concurrent starts by one second and honors abort while queued", async () => {
    vi.useFakeTimers();
    const base = vi.fn<RealEstateScraper.Transport>(async () => ({ status: 200, data: "ok" }));
    const send = resilientTransport(base, "onrealt", Date.now() + 10000, 1000);
    const request = { url: "https://onrealt.ru/", method: "GET", headers: {}, timeout: 30000 };
    const first = send(request);
    const second = send(request);
    const controller = new AbortController();
    const third = send({ ...request, signal: controller.signal }).catch(error => error);
    await first;
    expect(base).toHaveBeenCalledTimes(1);
    controller.abort();
    await third;
    await vi.advanceTimersByTimeAsync(999);
    expect(base).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(base).toHaveBeenCalledTimes(2);
    expect(base.mock.calls[1]?.[0]).toMatchObject({ timeout: 9000 });
  });
});
