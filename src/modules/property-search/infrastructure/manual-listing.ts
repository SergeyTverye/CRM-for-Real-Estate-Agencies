import { load } from "cheerio";
import RealEstateScraper from "real-estate-scrapper";
import { z } from "zod";
import { parseExternalUrl } from "@/shared/net/ssrf";
import type { Source } from "../domain/types";
import { normalizeListing } from "./normalization";
import { extractListingDates } from "./listing-dates";
import { scraperHttpRequest } from "./scraper-http";
import { detectAccessChallenge } from "./source-response";

const domains: Record<Source, string> = { cian: "cian.ru", avito: "avito.ru", domclick: "domclick.ru", yandex: "realty.yandex.ru", mirkvartir: "mirkvartir.ru", onrealt: "onrealt.ru", youla: "youla.ru" };
export function listingSourceUrl(raw: string): { source: Source; url: string } {
  const url = parseExternalUrl(raw);
  if (url.protocol !== "https:" || url.port && url.port !== "443") throw new Error("UNSAFE_SCRAPER_URL");
  const source = (Object.keys(domains) as Source[]).find(s => url.hostname === domains[s] || url.hostname.endsWith(`.${domains[s]}`));
  if (!source) throw new Error("UNSUPPORTED_LISTING_HOST");
  // Do not retain tracking/query tokens in manual fallback forms.
  url.search = ""; url.hash = "";
  return { source, url: url.href };
}
export const manualListingSchema = z.object({
  url: z.string().max(2000), title: z.string().trim().min(1).max(500), operation: z.enum(["sale", "rent"]),
  propertyType: z.enum(["office", "retail", "freePurpose", "industrial", "warehouse"]).nullable().default(null),
  price: z.number().finite().nonnegative().max(999_999_999_999_999).nullable().default(null),
  priceText: z.string().max(100).nullable().default(null), area: z.number().finite().positive().nullable().default(null),
  address: z.string().max(1000).nullable().default(null), city: z.string().max(120).nullable().default(null),
  description: z.string().max(20000).default(""),
}).strict();
export function manualListing(input: unknown, fetchedAt = new Date().toISOString()) {
  const fields = manualListingSchema.parse(input), identity = listingSourceUrl(fields.url);
  const listing = normalizeListing({ ...fields, ...identity, id: null, deal: fields.operation, rooms: null, floor: null, phone: null, images: [], district: null, timestamp: fetchedAt }, fetchedAt);
  return { ...listing, structuredFeatures: { ...listing.structuredFeatures, manualEntry: true } };
}
export type LinkListingResult = { status: "success"; listing: ReturnType<typeof normalizeListing> } | {
  status: "manual_required"; source: Source; url: string;
  reason: "needs_user_action" | "blocked" | "rate_limited" | "parse_failed" | "timeout" | "cancelled" | "fetch_failed";
};
/** Inert bytes only. Redirects and DNS use the same pinned SSRF guard as search. */
export async function addListingByUrl(raw: string, options: { signal?: AbortSignal; timeoutMs?: number; fetchedAt?: string } = {}): Promise<LinkListingResult> {
  const identity = listingSourceUrl(raw);
  const fallback = (reason: Extract<LinkListingResult, { status: "manual_required" }>["reason"]): LinkListingResult => ({ status: "manual_required", ...identity, reason });
  try {
    const response = await scraperHttpRequest(identity.url, { signal: options.signal, timeoutMs: Math.min(options.timeoutMs ?? 15000, 30000), maxBytes: 5_000_000 });
    const html = response.data.toString("utf8");
    if (detectAccessChallenge(response.url, html)) return fallback("needs_user_action");
    if (response.status === 429) return fallback("rate_limited");
    if ([401, 403, 439].includes(response.status)) return fallback("blocked");
    if (response.status >= 400) return fallback("fetch_failed");
    const fetchedAt = options.fetchedAt ?? new Date().toISOString();
    const parser = new RealEstateScraper().parsers[identity.source];
    try {
      const page = parser.parsePage(html, identity.url, {});
      const row = page.results.find(row => new URL(row.url).pathname === new URL(identity.url).pathname);
      if (row) return { status: "success", listing: { ...normalizeListing(row, fetchedAt), ...extractListingDates(identity.source, html, { id: row.id, url: identity.url }, fetchedAt) } };
    } catch { /* Detail cards often differ from search cards; inspect JSON-LD. */ }
    const $ = load(html);
    let result: ReturnType<typeof normalizeListing> | undefined;
    $("script[type='application/ld+json']").each((_, el) => {
      let data: unknown;
      try { data = JSON.parse($(el).text()); } catch { return; }
      const walk = (node: unknown, depth = 0) => {
        if (!node || typeof node !== "object" || depth > 15) return;
        if (Array.isArray(node)) { node.forEach(v => walk(v, depth + 1)); return; }
        const n = node as Record<string, unknown>, offer = n.offers as Record<string, unknown> | undefined;
        const candidate = typeof n.url === "string" ? n.url : typeof offer?.url === "string" ? offer.url : undefined;
        if (candidate && typeof n.name === "string" && offer && typeof offer === "object") {
          let same = false;
          try { same = listingSourceUrl(new URL(candidate, identity.url).href).url === identity.url; } catch { return; }
          if (same) {
            // Operation is not inferred from a price; retain unknown unless explicit.
            const listing = manualListing({ url: identity.url, title: n.name, operation: /rent|lease/iu.test(String(offer.businessFunction)) ? "rent" : "sale", price: Number.isFinite(Number(offer.price)) && offer.price !== undefined ? Number(offer.price) : null, address: typeof n.address === "string" ? n.address : null, description: typeof n.description === "string" ? n.description : "" }, fetchedAt);
            result = { ...listing, operation: /rent|lease/iu.test(String(offer.businessFunction)) ? "rent" : /sell|sale/iu.test(String(offer.businessFunction)) ? "sale" : null, ...extractListingDates(identity.source, node, { url: identity.url }, fetchedAt), structuredFeatures: {} };
          }
        }
        Object.values(n).forEach(v => walk(v, depth + 1));
      }; walk(data);
    });
    return result ? { status: "success", listing: result } : fallback("parse_failed");
  } catch (error) {
    return fallback(options.signal?.aborted ? "cancelled" : error instanceof Error && error.message === "NETWORK_TIMEOUT_OR_ABORT" ? "timeout" : "fetch_failed");
  }
}
