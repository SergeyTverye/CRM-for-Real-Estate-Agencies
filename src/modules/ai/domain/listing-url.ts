export const MARKET_DOMAINS = ["cian.ru", "avito.ru", "domclick.ru", "realty.yandex.ru", "mirkvartir.ru", "onrealt.ru", "youla.ru"];


export function listingUrlRejection(raw: string, domains: string[] = MARKET_DOMAINS): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return "INVALID_URL"; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "UNSAFE_URL";
  const host = url.hostname.toLowerCase();
  if (!domains.some(d => host === d || host.endsWith(`.${d}`))) return "DOMAIN_NOT_ALLOWED";
  if (!MARKET_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "UNSUPPORTED_CARD_PATTERN";
  return isMarketCatalogue(raw) ? "CATALOGUE_NOT_LISTING" : null;
}


export function isMarketCatalogue(raw: string): boolean {
  const { hostname, pathname } = new URL(raw);
  const host = hostname.toLowerCase();
  const at = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  
  
  const url = new URL(raw);
  if (url.hash || [...url.searchParams.keys()].some(key => !/^(?:utm_[a-z_]+|from|source|yclid|gclid)$/iu.test(key))) return true;
  if (/(?:^|[\/_-])(?:sitemap|search|catalog|map|list|nedorogo)(?:[\/_.-]|$)/iu.test(pathname.replace(/%[0-9a-f]{2}/giu, code => String.fromCharCode(parseInt(code.slice(1), 16))))) return true;
  if (at("avito.ru")) return !/^\/[^/]+\/kommercheskaya_nedvizhimost\/[^/]+_\d{6,}\/?$/u.test(pathname);
  if (at("cian.ru")) return !/^\/(?:sale|rent)\/commercial\/\d+\/?$/u.test(pathname);
  if (at("realty.yandex.ru")) return !/^\/offer\/\d+\/?$/u.test(pathname);
  if (at("domclick.ru")) return !/^\/card\/(?:sale|rent)__commercial__\d+\/?$/u.test(pathname);
  if (at("onrealt.ru")) return !/^\/[a-z]+(?:-[a-z]+)*\/[a-z]+(?:-[a-z]+)*\/\d+\/?$/u.test(pathname);
  if (at("mirkvartir.ru")) return !/^\/\d+\/?$/u.test(pathname);
  if (at("youla.ru")) return !/^\/[^/]+\/nedvijimost\/kommercheskaya-nedvijimost\/[^/]+-[a-f0-9]{24}\/?$/u.test(pathname);
  return false;
}
