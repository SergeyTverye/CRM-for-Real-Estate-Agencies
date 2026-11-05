export const MARKET_DOMAINS = ["cian.ru", "avito.ru", "domclick.ru", "realty.yandex.ru", "mirkvartir.ru", "onrealt.ru", "youla.ru"];

/** Fail closed: a host allowlist alone cannot distinguish a catalogue from a card. */
export function listingUrlRejection(raw: string, domains: string[] = MARKET_DOMAINS): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return "INVALID_URL"; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "UNSAFE_URL";
  const host = url.hostname.toLowerCase();
  if (!domains.some(d => host === d || host.endsWith(`.${d}`))) return "DOMAIN_NOT_ALLOWED";
  if (!MARKET_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "UNSUPPORTED_CARD_PATTERN";
  return isMarketCatalogue(raw) ? "CATALOGUE_NOT_LISTING" : null;
}

/** Known market catalogues are navigation hints, never individual listings. */
export function isMarketCatalogue(raw: string): boolean {
  const { hostname, pathname } = new URL(raw);
  const host = hostname.toLowerCase();
  const at = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (at("avito.ru")) return !/^\/[^/]+\/kommercheskaya_nedvizhimost\/[^/]+_\d{6,}\/?$/u.test(pathname);
  if (at("cian.ru")) return !/^\/(?:sale|rent)\/commercial\/\d+\/?$/u.test(pathname);
  if (at("realty.yandex.ru")) return !/^\/offer\/\d+\/?$/u.test(pathname);
  if (at("domclick.ru")) return !/^\/card\/(?:sale|rent)__commercial__\d+\/?$/u.test(pathname);
  if (at("onrealt.ru")) return !/^\/[^/]+\/[^/]+\/\d+\/?$/u.test(pathname);
  if (at("mirkvartir.ru")) return !/^\/\d+\/?$/u.test(pathname);
  if (at("youla.ru")) return !/^\/[^/]+\/nedvijimost\/kommercheskaya-nedvijimost\/[^/]+-[a-f0-9]{24}\/?$/u.test(pathname);
  return false;
}
