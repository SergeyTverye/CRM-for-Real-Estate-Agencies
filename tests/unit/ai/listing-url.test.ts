import { describe, expect, it } from "vitest";
import { isMarketCatalogue } from "@/modules/ai/domain/listing-url";
describe("web results must identify a listing", () => {
  it.each([
    "https://novosibirsk.domclick.ru/pokupka-commerce",
    "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam-ASgBAgICAUSwCNJW",
    "https://novosibirsk.cian.ru/kupit-ofis/",
    "https://realty.yandex.ru/novosibirsk/kupit/kommercheskaya-nedvizhimost/",
  ])("rejects a market catalogue: %s", url => expect(isMarketCatalogue(url)).toBe(true));
  it.each([
    "https://novosibirsk.cian.ru/sale/commercial/123456789/",
    "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/ofis_123456789",
    "https://realty.yandex.ru/offer/123456789/",
    "https://novosibirsk.domclick.ru/card/sale__commercial__12345",
    "https://example.com/listing/42",
  ])("retains possible listing URLs for further verification: %s", url => expect(isMarketCatalogue(url)).toBe(false));
});
