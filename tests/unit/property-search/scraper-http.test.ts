import https from "node:https";
import { EventEmitter } from "node:events";
import type http from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalScraperUrl, scraperHttpRequest } from "@/modules/property-search/infrastructure/scraper-http";
import { classifyScraperErrors, scraperErrorReason } from "@/modules/property-search/infrastructure/source-filters";

afterEach(() => vi.restoreAllMocks());
const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
function responses(pages: { status: number; location?: string }[]) {
  let index = 0;
  return vi.spyOn(https, "request").mockImplementation(((_url: URL, _options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => {
      const page = pages[index++]!;
      const res = new EventEmitter() as EventEmitter & { headers: http.IncomingHttpHeaders; statusCode: number };
      res.headers = page.location ? { location: page.location } : {}; res.statusCode = page.status;
      callback(res as http.IncomingMessage); res.emit("end");
    };
    return req as unknown as http.ClientRequest;
  }) as typeof https.request);
}
it("builds observed canonical routes directly without dropping other constraints", () => {
  expect(canonicalScraperUrl("https://realty.yandex.ru/novosibirsk/kupit/kommercheskaya-nedvizhimost/?commercialType=OFFICE&page=1&areaMin=40"))
    .toBe("https://realty.yandex.ru/novosibirsk/kupit/kommercheskaya-nedvizhimost/ofis/?page=1&areaMin=40");
  const mir = new URL(canonicalScraperUrl("https://cre.mirkvartir.ru/listing/?locationIds=MK_Town%7C106136&types=101&p=1&areaFrom=40"));
  expect(decodeURI(mir.pathname)).toBe("/Новосибирская+область/Новосибирск/Офисы/");
  expect(mir.search).toBe("?areaFrom=40");
  const or = "https://realty.yandex.ru/novosibirsk/kupit/kommercheskaya-nedvizhimost/?commercialType=OFFICE&commercialType=WAREHOUSE";
  expect(canonicalScraperUrl(or)).toBe(or);
});
it("follows same-site HTTPS redirects with fresh DNS validation on every hop", async () => {
  resolve.mockClear();
  const request = responses([{ status: 301, location: "https://www.mirkvartir.ru/next" }, { status: 302, location: "/end" }, { status: 200 }]);
  const result = await scraperHttpRequest("https://cre.mirkvartir.ru/start", { resolve, headers: { Cookie: "synthetic", Authorization: "synthetic" } });
  expect(result.url).toBe("https://www.mirkvartir.ru/end"); expect(resolve).toHaveBeenCalledTimes(3);
  expect((request.mock.calls[1]?.[1] as http.RequestOptions).headers).not.toHaveProperty("Cookie");
  expect((request.mock.calls[1]?.[1] as http.RequestOptions).headers).not.toHaveProperty("Authorization");
});
it.each(["http://realty.yandex.ru/a", "https://evil.example/a", "https://yandex.ru.evil.example/a", "https://user:pass@realty.yandex.ru/a"])("rejects unsafe redirect %s before fetching it", async location => {
  const request = responses([{ status: 301, location }]);
  await expect(scraperHttpRequest("https://realty.yandex.ru/start", { resolve })).rejects.toThrow("UNSAFE_SCRAPER_REDIRECT");
  expect(request).toHaveBeenCalledOnce();
});
it("rejects a same-domain target resolving to a private address", async () => {
  const request = responses([{ status: 302, location: "https://private.yandex.ru/a" }]);
  const dns = vi.fn().mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  await expect(scraperHttpRequest("https://realty.yandex.ru/start", { resolve: dns })).rejects.toThrow("UNSAFE_ADDRESS");
  expect(dns).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledOnce();
});
it("allows three redirects and stops the fourth without retry", async () => {
  const request = responses(Array.from({ length: 4 }, (_, i) => ({ status: 302, location: `/hop-${i}` })));
  await expect(scraperHttpRequest("https://realty.yandex.ru/start", { resolve })).rejects.toThrow("SCRAPER_REDIRECT_LIMIT");
  expect(request).toHaveBeenCalledTimes(4);
});
it.each([401, 403, 429])("reports HTTP %s as blocked with a reason", status => {
  expect(classifyScraperErrors([{ code: "FETCH_FAILED", status }])).toBe("blocked");
  expect(scraperErrorReason({ code: "FETCH_FAILED", status })).toContain(`HTTP ${status}`);
});
