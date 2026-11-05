/** Known market catalogues are navigation hints, never individual listings. */
export function isMarketCatalogue(raw: string): boolean {
  const { hostname, pathname } = new URL(raw);
  const host = hostname.toLowerCase();
  const at = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (at("avito.ru")) return !/_\d{6,}\/?$/u.test(pathname);
  if (at("cian.ru")) return !/\/(?:sale|rent)\/commercial\/\d+\/?$/u.test(pathname);
  if (at("realty.yandex.ru")) return !/\/offer\/\d+\/?$/u.test(pathname);
  if (at("domclick.ru")) return !/\/(?:card|offer)\//u.test(pathname);
  if (at("onrealt.ru")) return !/\/\d+(?:-[^/]+)?\/?$/u.test(pathname);
  if (at("mirkvartir.ru")) return !/\/\d+\/?$/u.test(pathname);
  return false;
}
