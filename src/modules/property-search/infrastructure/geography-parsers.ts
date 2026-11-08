import { load } from "cheerio";
import type RealEstateScraper from "real-estate-scrapper";
import { resolveDistrict } from "../domain/geography";

/** Read locality evidence from the card, never from the requested search scope. */
export function attachGeographyParsers(client: RealEstateScraper): void {
  const parser = client.parsers.onrealt, parse = parser.parsePage.bind(parser);
  parser.parsePage = (payload, url, query) => {
    const page = parse(payload, url, query);
    if (typeof payload !== "string") return page;
    const $ = load(payload);
    const facts = new Map<string, string>();
    const cardUrls = new Set<string>();
    $(".ad-item-container").each((_, el) => {
      const card = $(el), href = card.find("a[url-item]").first().attr("href");
      const locality = card.find("[address-city]").first().text().replace(/\s+/gu, " ").trim();
      if (href) {
        const absolute = new URL(href, url).href; cardUrls.add(absolute);
        if (locality) facts.set(absolute, locality);
      }
    });
    return { ...page, results: page.results.filter(item => !$(".ad-item-container").length || cardUrls.has(item.url)).map(item => {
      const locality = facts.get(item.url);
      if (!locality) return item;
      const city = locality.split(",").map(v => v.trim()).find(v => !/(?:область|край|район|р-н)$/iu.test(v)) ?? null;
      const address = [locality, item.address].filter(Boolean).join(", ");
      return { ...item, city, address, district: resolveDistrict(city, item.district, address) };
    }) };
  };
}
