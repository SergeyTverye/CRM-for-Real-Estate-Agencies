import { describe, expect, it } from "vitest";
import evidence from "../../../docs/vkr/live-ai-evidence.json";
import { isMarketCatalogue, listingUrlRejection } from "@/modules/ai/domain/listing-url";
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


describe("strict card allowlist", () => {
  it.each(["sitemap", "search", "catalog", "map", "list", "nedorogo", "arenda-sklada-nedorogo", "sitemap.xml"])("rejects navigation segments on every platform: %s", segment => {
    for (const host of ["onrealt.ru", "cian.ru", "avito.ru", "domclick.ru", "realty.yandex.ru", "mirkvartir.ru", "youla.ru"]) {
      expect(listingUrlRejection(`https://${host}/novosibirsk/${segment}/12345`)).not.toBeNull();
    }
    expect(listingUrlRejection(`https://avito.ru/novosibirsk/kommercheskaya_nedvizhimost/${segment}_1234567`)).not.toBeNull();
  });
  it.each(["?search=office", "?map=1", "?catalog=1", "#list", "#search"])("rejects navigation query or fragment: %s", suffix => {
    expect(listingUrlRejection(`https://onrealt.ru/novosibirsk/kypit-ofis/12345${suffix}`)).not.toBeNull();
  });
  it("retains known card tracking parameters", () => expect(listingUrlRejection("https://onrealt.ru/novosibirsk/snyat-sklad/12345?utm_source=crm")).toBeNull());
  it.each(["arenda-sklada", "arenda-ofisa", "arenda-pomeshcheniya", "kypit-sklad", "snyat-torgovuyu-ploshchad", "arenda-proizvodstva"])("accepts OnRealt card slugs without a grammatical allowlist: %s", slug => {
    expect(listingUrlRejection(`https://onrealt.ru/novosibirsk/${slug}/86529013`)).toBeNull();
  });
  const liveUrls = new Set<string>();
  function collectListings(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("source" in value && "url" in value && typeof value.url === "string" && ["onrealt", "yandex", "mirkvartir"].includes(String(value.source))) liveUrls.add(value.url);
    for (const child of Object.values(value)) collectListings(child);
  }
  collectListings(evidence);
  it("covers all three live evidence sources", () => {
    for (const host of ["onrealt.ru", "realty.yandex.ru", "mirkvartir.ru"]) expect([...liveUrls].some(url => new URL(url).hostname.endsWith(host))).toBe(true);
  });
  
  
  const serviceUrls = [...liveUrls].filter(url => /(?:^|[/-])nedorogo(?:[/-]|$)/u.test(new URL(url).pathname));
  it.each(serviceUrls)("rejects a service URL retained in evidence %s", url => expect(listingUrlRejection(url)).toBe("CATALOGUE_NOT_LISTING"));
  it.each([...liveUrls].filter(url => !serviceUrls.includes(url)))("accepts the saved live listing %s", url => expect(listingUrlRejection(url)).toBeNull());
  it.each([
    "https://cian.ru/sale/commercial/123456789/",
    "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/ofis_123456789",
    "https://realty.yandex.ru/offer/123456789/",
    "https://novosibirsk.domclick.ru/card/sale__commercial__12345",
    "https://cre.mirkvartir.ru/361166102/",
    "https://onrealt.ru/novosibirsk/kypit-ofis/86529013",
    "https://youla.ru/novosibirsk/nedvijimost/kommercheskaya-nedvijimost/ofis-0123456789abcdef01234567",
  ])("accepts only supported card shape %s", url => expect(listingUrlRejection(url)).toBeNull());
  it.each([
    "https://cian.ru/kupit-ofis/", "https://avito.ru/novosibirsk/kommercheskaya_nedvizhimost",
    "https://realty.yandex.ru/novosibirsk/kupit/", "https://domclick.ru/card/",
    "https://domclick.ru/card/search", "https://cre.mirkvartir.ru/Novosibirsk/",
    "https://onrealt.ru/novosibirsk/kypit-ofis", "https://youla.ru/novosibirsk/nedvijimost",
  ])("explains rejected catalogue %s", url => expect(listingUrlRejection(url)).toBe("CATALOGUE_NOT_LISTING"));
  it.each(["https://cian.ru.evil.test/sale/commercial/123/", "https://example.com/listing/42", "http://127.0.0.1/"])("rejects unknown/private host %s", url => expect(listingUrlRejection(url)).not.toBeNull());
  it.each(["bad", "file:///tmp/file", "https://u:p@cian.ru/sale/commercial/123/", "https://cian.ru:444/sale/commercial/123/"])("rejects unsafe URL %s", url => expect(listingUrlRejection(url)).not.toBeNull());
});
