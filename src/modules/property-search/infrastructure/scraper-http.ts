import { safeRequest, type SafeRequestOptions } from "../../../shared/net/ssrf";

type Response = Awaited<ReturnType<typeof safeRequest>>;
const siteDomains = ["cian.ru", "avito.ru", "youla.ru", "yandex.ru", "onrealt.ru", "domclick.ru", "mirkvartir.ru"];
function siteDomain(url: URL): string | undefined {
  return siteDomains.find(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

/** Canonical search routes observed in the sites' own 301 Location headers. */
export function canonicalScraperUrl(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === "realty.yandex.ru" && /\/kommercheskaya-nedvizhimost\/$/u.test(url.pathname)) {
    const types = url.searchParams.getAll("commercialType");
    const route = ({ OFFICE: "ofis", RETAIL: "torgovoe-pomeshchenie", WAREHOUSE: "sklad", FREE_PURPOSE: "pomeshchenie-svobodnogo-naznacheniya", MANUFACTURING: "proizvodstvennoe-pomeshchenie" } as Record<string, string>)[types[0] ?? ""];
    if (types.length === 1 && route) { url.pathname += `${route}/`; url.searchParams.delete("commercialType"); }
  }
  if (["cre.mirkvartir.ru", "arendacre.mirkvartir.ru"].includes(url.hostname) && url.pathname === "/listing/") {
    const city = url.searchParams.get("locationIds") === "MK_Town|106136" ? "Новосибирская+область/Новосибирск" : null;
    const type = url.searchParams.get("types");
    const route = type === "101" ? "Офисы" : null;
    if (city && (!type || route) && url.searchParams.getAll("types").length <= 1 && url.searchParams.getAll("locationIds").length === 1) {
      url.pathname = `/${city}/${route ? `${route}/` : ""}`;
      url.searchParams.delete("locationIds"); url.searchParams.delete("types");
      if (url.searchParams.get("p") === "1") url.searchParams.delete("p");
    }
  }
  return url.href;
}

/** Explicit site allowlist avoids guessing registrable domains from the last two labels. */
export async function scraperHttpRequest(raw: string, options: SafeRequestOptions & {
  beforeRequest?: (url: string) => void;
  onResponse?: (response: Response) => void;
} = {}): Promise<Response> {
  let url = new URL(canonicalScraperUrl(raw));
  const domain = siteDomain(url);
  if (url.protocol !== "https:" || !domain || url.username || url.password) throw new Error("UNSAFE_SCRAPER_URL");
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let method = options.method ?? "GET", body = options.body, headers = options.headers;
  for (let redirects = 0; ; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("NETWORK_TIMEOUT_OR_ABORT");
    options.beforeRequest?.(url.href);
    // safeRequest repeats DNS/private-IP validation and pins every individual hop.
    const response = await safeRequest(url.href, { ...options, method, body, headers, timeoutMs: remaining, followRedirects: false });
    options.onResponse?.(response);
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) return response;
    if (redirects >= 3) throw new Error("SCRAPER_REDIRECT_LIMIT");
    const next = new URL(response.headers.location, url);
    if (next.protocol !== "https:" || siteDomain(next) !== domain || next.username || next.password) throw new Error("UNSAFE_SCRAPER_REDIRECT");
    if (next.origin !== url.origin && headers) headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())));
    if (response.status === 303 || ([301, 302].includes(response.status) && method === "POST")) { method = "GET"; body = undefined; }
    url = next;
  }
}
