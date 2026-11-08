import { setTimeout as pause } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import type RealEstateScraper from "real-estate-scrapper";
import { parseSourceDate } from "./listing-dates";
import type { DateDetailOptions } from "./date-enrichment";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";
const num = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !/^-?\d+(?:[.,]\d+)?$/u.test(v))) return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
};
const fail = (code: string): never => { throw Object.assign(new Error(code), { code, source: "youla" }); };
const types: Record<string, string> = { flat: "kvartiri", studio: "kvartiri", room: "komnati", house: "doma", cottage: "doma" };
const categories: Record<string, { type: string; deal: "sale" | "rent" | "daily" }> = {
  "2001": { type: "flat", deal: "sale" }, "2002": { type: "room", deal: "sale" }, "2003": { type: "house", deal: "sale" },
  "2005": { type: "flat", deal: "rent" }, "2006": { type: "room", deal: "rent" }, "2007": { type: "house", deal: "rent" },
  "2010": { type: "flat", deal: "daily" }, "2011": { type: "room", deal: "daily" }, "2012": { type: "house", deal: "daily" },
};
const commercialTypes: Record<string, NonNullable<RealEstateScraper.Listing["propertyType"]>> = {
  "165972": "office", "165970": "freePurpose", "165973": "industrial", "165974": "warehouse", "165971": "retail",
};
const roomIds: Record<number, string> = { 0: "10660", 1: "10654", 2: "10655", 3: "10656", 4: "10657" };
export const YOULA_FEED_HASH = "6e7275a709ca5eb1df17abfb9d5d68212ad910dd711d55446ed6fa59557e2602";

/** Inert JSON only. No eval, script execution or recursive scanning of seller data. */
export function youlaState(payload: unknown): Row {
  if (typeof payload !== "string") return {};
  const match = /window\.__YOULA_STATE__\s*=\s*(\{)/u.exec(payload);
  if (!match) return {};
  const start = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < payload.length; i++) {
    const ch = payload[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { try { return row(JSON.parse(payload.slice(start, i + 1))); } catch { return {}; } }
  }
  return {};
}
function sourceUrl(value: unknown): string {
  let u: URL;
  try { u = new URL(str(value), "https://youla.ru"); } catch { return fail("INVALID_URL"); }
  if (!str(value) || u.protocol !== "https:" || u.username || u.password || !/^(?:www\.)?youla\.ru$/u.test(u.hostname)) return fail("INVALID_URL");
  return u.toString();
}
const attribute = (p: Row, slug: string): Row => Array.isArray(p.attributes) ? row(p.attributes.find(a => row(a).slug === slug)) : {};
const attrId = (p: Row, slug: string): string => String(row((attribute(p, slug).values as unknown[] | undefined)?.[0]).id ?? "");

/** Whitelist output: seller IDs, names, phones and raw descriptions never enter replay/CRM DTOs. */
export function parseYoulaProduct(value: unknown, cityName: string | null = null): RealEstateScraper.Listing & { residentialType: string | null; publishedAt: string | null; sourceUpdatedAt: string | null } {
  const p = row(value), location = row(p.location), price = row(p.price);
  const id = str(p.id), title = str(p.name), url = sourceUrl(p.url);
  if (!id || !title) return fail("PARSE_FAILED");
  const categoryId = String(p.subcategoryId ?? p.subcategory ?? "");
  const housing = categories[categoryId];
  const isCommercial = categoryId === "2013";
  const roomsId = attrId(p, "komnat_v_kvartire");
  const rooms = Object.entries(roomIds).find(([, id]) => id === roomsId)?.[0];
  const titleRooms = title.match(/(?:^|\s|,)\s*(\d+)\s*[-–]?\s*(?:комнат|комн\b|к\b)/iu);
  const studio = roomsId === "10660" || housing?.type === "flat" && /студи/iu.test(title);
  const rawArea = num(attribute(p, "realty_obshaya_ploshad").rawValue);
  const areaText = title.match(/(\d+(?:[.,]\d+)?)\s*(?:м²|м2)/u);
  const floor = num(attribute(p, "realty_etaj").rawValue) ?? num(title.match(/(-?\d+)\s*\/\s*\d+\s*эт/iu)?.[1]);
  const commercialDeal = attrId(p, "tip_sdelki");
  const deal = housing?.deal ?? (isCommercial ? commercialDeal === "10806" ? "rent" : commercialDeal === "10807" ? "sale" : null : null);
  const fetchedAt = new Date().toISOString();
  const date = (v: unknown) => parseSourceDate(row(v).timestamp ?? row(v).date ?? v, fetchedAt)?.at ?? null;
  const address = str(location.addressText) || str(location.description) || str(location.address);
  const district = str(location.district) || address.split(",").map(s => s.trim()).find(s => /(?:район|р-н)$/iu.test(s)) || null;
  const amount = typeof p.price === "number" ? p.price : num(row(price.realPrice).price);
  return { source: "youla", id, title, url, category: housing ? "residential" : isCommercial ? "commercial" : null,
    residentialType: housing ? studio ? "studio" : housing.type : null,
    propertyType: isCommercial ? commercialTypes[attrId(p, "kommer_realty_tip_stroeniya")] ?? null : null,
    deal, price: amount === null ? null : amount / 100,
    // Even long-term category is not evidence of a monthly price unit.
    priceText: str(price.realPriceText) || str(p.priceText) || null,
    rooms: studio ? 0 : rooms !== undefined ? Number(rooms) : titleRooms ? Number(titleRooms[1]) : null,
    area: rawArea !== null ? rawArea / 100 : areaText ? num(areaText[1]) : null,
    floor, floorType: floor === null ? null : floor > 0 ? "aboveGround" : "basement",
    city: str(location.cityName) || cityName, address, district,
    images: Array.isArray(p.images) ? p.images.map(i => str(row(i).url)).filter(u => /^https:\/\//u.test(u)) : [],
    description: null, phone: null, sellerType: attrId(p, "sobstvennik_ili_agent") === "10705" ? "owner" : attrId(p, "sobstvennik_ili_agent") === "10706" ? "agent" : null,
    publishedAt: date(p.datePublished), sourceUpdatedAt: date(p.dateUpdated), timestamp: fetchedAt };
}

export function parseYoulaFeed(payload: unknown, url: string, cityId: string) {
  const root = row(payload), feed = row(row(root.data).feed), info = row(feed.pageInfo);
  if (Array.isArray(root.errors) && root.errors.length || !Array.isArray(feed.items) || typeof info.hasNextPage !== "boolean") return fail("API_RESPONSE_FAILED");
  const current = new URL(url).searchParams.get("cursor") || "";
  const cursor = str(info.cursor);
  if (info.hasNextPage && (!cursor || cursor === current)) return fail("PAGINATION_FAILED");
  const products = feed.items.flatMap(item => row(item).product ? [row(row(item).product)] : []);
  const results = products.filter(p => str(row(p.location).city) === cityId).map(p => parseYoulaProduct(p));
  const next = new URL(url); next.searchParams.set("cursor", cursor);
  return { results, hasNext: info.hasNextPage, nextUrl: info.hasNextPage ? next.toString() : null };
}

/** Public website GraphQL contract verified against LIVE; all I/O uses guarded parser.fetch. */
export function attachYoulaParser(client: RealEstateScraper, options: DateDetailOptions & { minRequestIntervalMs?: number } = {}): void {
  const parser = client.parsers.youla, originalBuild = parser.buildSearchUrl.bind(parser);
  const cities = new Map<string, { id: string; name: string | null }>();
  let detailCount = 0, detailsStopped = false;
  const detailLimit = Math.min(10, options.maxCards ?? 3);
  const deadline = options.deadline ?? Infinity;
  const publicUid = randomBytes(7).toString("hex");
  let lastRequestAt = 0;
  const request = async (url: string, input: Record<string, unknown> = {}) => {
    const wait = lastRequestAt + (options.minRequestIntervalMs ?? 1100) - Date.now();
    if (wait > 0) {
      try { await pause(wait, undefined, { signal: input.signal as AbortSignal | undefined }); }
      catch { return fail("ABORTED"); }
    }
    if (Date.now() >= deadline) return fail("TIMEOUT");
    lastRequestAt = Date.now();
    return parser.fetch(url, input);
  };
  parser.buildSearchUrl = (q = {}) => {
    if (q.category !== "residential" && q.category !== "жилая" && !types[q.type ?? ""]) return originalBuild(q);
    const suffix = types[q.type ?? "flat"];
    if (!suffix || q.deal === "daily") return fail("UNSUPPORTED_FILTER");
    const o = q.sourceOptions?.youla;
    const slug = o?.citySlug ?? q.citySlug ?? ({ "Новосибирск": "novosibirsk", "Москва": "moskva" } as Record<string, string>)[q.city ?? ""];
    if (!slug && !o?.url) return fail("LOCATION_REQUIRED");
    const url = new URL(sourceUrl(o?.url ?? `https://youla.ru/${slug}/nedvijimost/${q.deal === "sale" ? "prodaja" : "arenda"}-${suffix}`));
    if (!/^\/[^/]+\/nedvijimost\/(?:prodaja|arenda)-(?:kvartiri|komnati|doma)\/?$/u.test(url.pathname)) return fail("UNSUPPORTED_FILTER");
    const rooms = q.type === "studio" ? [0] : q.rooms === undefined ? [] : Array.isArray(q.rooms) ? q.rooms : [q.rooms];
    for (const [i, n] of rooms.entries()) { if (!roomIds[n]) return fail("UNSUPPORTED_FILTER"); url.searchParams.set(`attributes[komnat_v_kvartire][${i}]`, roomIds[n]!); }
    for (const [prefix, native] of [["area", "realty_obshaya_ploshad"], ["price", "price"]] as const) {
      for (const [bound, key] of [["Min", "from"], ["Max", "to"]] as const) {
        const n = q[`${prefix}${bound}`]; if (n !== undefined) url.searchParams.set(`attributes[${native}][${key}]`, String(Math.round(n * 100)));
      }
    }
    if (q.query) url.searchParams.set("q", q.query);
    for (const [key, v] of Object.entries(o?.params ?? {})) { url.searchParams.delete(key); if (v !== null) for (const part of Array.isArray(v) ? v : [v]) url.searchParams.append(key, String(part)); }
    return url.toString();
  };
  parser.searchPage = async (q = {}, pageUrl?: string) => {
    const url = sourceUrl(pageUrl ?? parser.buildSearchUrl(q)), u = new URL(url);
    if ((q.page ?? 1) > 1 && !u.searchParams.get("cursor")) return fail("CURSOR_REQUIRED");
    const slug = u.pathname.split("/")[1]!;
    let city = cities.get(slug);
    if (q.sourceOptions?.youla?.cityId) city = { id: q.sourceOptions.youla.cityId, name: q.city ?? null };
    if (!city) {
      const state = youlaState(await request(url, { signal: q.signal }));
      const candidates = row(state.entities).cities;
      const found = (Array.isArray(candidates) ? candidates : Object.values(row(candidates))).map(row).find(c => c.slug === slug);
      if (!str(found?.id)) return fail("LOCATION_NOT_FOUND");
      city = { id: str(found?.id), name: str(found?.name) || null }; cities.set(slug, city);
    }
    const category = u.pathname.split("/")[3];
    if (!category || !["prodaja-kvartiri", "prodaja-komnati", "prodaja-doma", "arenda-kvartiri", "arenda-komnati", "arenda-doma", "kommercheskaya-nedvijimost"].includes(category)) return fail("UNSUPPORTED_FILTER");
    const attributes = new Map<string, { slug: string; value: string[] | null; from: number | null; to: number | null }>();
    for (const [key, value] of u.searchParams) {
      const m = /^attributes\[([^\]]+)\]\[([^\]]+)\]$/u.exec(key); if (!m) continue;
      const a = attributes.get(m[1]!) ?? { slug: m[1]!, value: null, from: null, to: null };
      if (m[2] === "from" || m[2] === "to") a[m[2]] = num(value); else (a.value ??= []).push(value);
      attributes.set(a.slug, a);
    }
    attributes.set("categories", { slug: "categories", value: [category], from: null, to: null });
    const payload = await request("https://api-gw.youla.ru/graphql", { method: "POST", signal: q.signal,
      headers: { appId: "web/3", "x-app-id": "web/3", uid: publicUid, "x-uid": publicUid, "x-offset-utc": "3", authorization: "", "Content-Type": "application/json", Referer: "https://youla.ru/" },
      data: { operationName: "catalogProductsBoard", variables: { sort: "DEFAULT", attributes: [...attributes.values()], datePublished: null,
        location: { latitude: null, longitude: null, city: city.id, distanceMax: null }, search: u.searchParams.get("q") || "", cursor: u.searchParams.get("cursor") || "" },
      extensions: { persistedQuery: { version: 1, sha256Hash: YOULA_FEED_HASH } } } });
    const page = parseYoulaFeed(payload, url, city.id);
    for (let i = 0; i < Math.min(page.results.length, q.limit ?? page.results.length); i++) {
      if (detailsStopped || detailCount >= detailLimit || Date.now() >= deadline || q.signal?.aborted) break;
      const item = page.results[i]!; detailCount++;
      try {
        const detailController = new AbortController();
        const abort = () => detailController.abort();
        q.signal?.addEventListener("abort", abort, { once: true });
        if (q.signal?.aborted) abort();
        const timer = setTimeout(abort, Math.max(1, Math.min(3000, deadline - Date.now() - 1000)));
        let detailPayload: unknown;
        try { detailPayload = await request(item.url, { signal: detailController.signal }); }
        catch (error) { if (detailController.signal.aborted && !q.signal?.aborted) throw Object.assign(new Error("DETAIL_TIMEOUT"), { code: "DETAIL_TIMEOUT" }); throw error; }
        finally { clearTimeout(timer); q.signal?.removeEventListener("abort", abort); }
        const state = youlaState(detailPayload);
        const product = row(row(row(state.entities).products)[item.id!]);
        if (product.id !== item.id) continue;
        if (product.isDeleted || product.isArchived || product.isSold || product.isBlocked) { page.results.splice(i--, 1); continue; }
        // Preserve city and period text from feed when the detail omits them.
        const detail = parseYoulaProduct(product, item.city);
        if (str(row(product.location).city) && row(product.location).city !== city.id) continue;
        page.results[i] = { ...detail, priceText: detail.priceText || item.priceText, images: detail.images.length ? detail.images : item.images };
      } catch (error) {
        const code = row(row(error).cause).code ?? row(error).code;
        if (["NEEDS_USER_ACTION", "ACCESS_BLOCKED", "RATE_LIMITED", "ABORTED"].includes(str(code))) throw Object.assign(error instanceof Error ? error : new Error(str(code)), { code });
        detailsStopped = true; // Keep SERP facts; no invented date/floor on unavailable details.
      }
    }
    return { ...page, source: "youla", page: q.page ?? 1, url };
  };
}
