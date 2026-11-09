import { listingQuality } from "./listing-quality";
import { selectedLocations } from "../domain/geography";
import type RealEstateScraper from "real-estate-scrapper";

type RecordValue = Record<string, unknown>;
type HousingType = "flat" | "studio" | "room" | "house" | "cottage" | "townhouse";
const housing = new Set<string>(["flat", "studio", "room", "house", "cottage", "townhouse"]);
const commercial = new Set(["office", "freeAppointment", "shoppingArea", "floorSpace", "warehouse", "industry", "production", "building", "commercial"]);
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:[.,]\d+)?$/u.test(value.trim()))) return null;
  const parsed = typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
function residential(query: RealEstateScraper.Query = {}): boolean {
  if (query.category === "commercial" || query.category === "коммерческая") return false;
  return query.category === "residential" || query.category === "жилая" || housing.has(text(query.type)) ||
    ["apartment", "квартира", "квартиры", "комната", "дом", "коттедж", "таунхаус", "студия"].includes(text(query.type));
}


function offersFromSsr(payload: unknown): RecordValue[] | null {
  if (typeof payload !== "string") return null;
  for (const script of payload.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)) {
    const body = script[1]!;
    if (!body.includes("['legacy-commercial-serp-frontend']")) continue;
    const marker = body.indexOf(".concat(");
    if (marker < 0) continue;
    const start = marker + ".concat(".length;
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < body.length; index++) {
      const char = body[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "[" || char === "{") depth++;
      else if (char === "]" || char === "}") {
        if (--depth !== 0) continue;
        try {
          const entries: unknown = JSON.parse(body.slice(start, index + 1));
          if (!Array.isArray(entries)) break;
          const state = record(entries.find(entry => record(entry).key === "initialState"));
          const offers = record(record(state.value).results).offers;
          if (Array.isArray(offers)) return offers.map(record);
        } catch {  }
        break;
      }
    }
  }
  return null;
}

function evidence(offer: RecordValue, listingUrl: string) {
  let path = "";
  try { const url = new URL(listingUrl); if (/(?:^|\.)cian\.ru$/u.test(url.hostname)) path = url.pathname; } catch {  }
  const route = path.match(/^\/(sale|rent)\/(flat|studio|room|house|cottage|townhouse|commercial|office|warehouse|building)\/\d+\/?$/u);
  const category = text(offer.category);
  const native = category.match(/^(flat|studio|room|house|cottage|townhouse)(Sale|Rent)$/u);
  const candidates = [text(offer.officeType), text(offer.propertyType), text(offer.type), category,
    ...(Array.isArray(offer.types) ? offer.types.map(text) : [])];
  
  const isCommercial = candidates.some(value => commercial.has(value)) || category === "commercialSale" || category === "commercialRent" || Boolean(route && commercial.has(route[2]!));
  const kind = candidates.find(value => housing.has(value)) ?? native?.[1] ?? (route && housing.has(route[2]!) ? route[2] : null);
  const deal = ["sale", "rent", "daily"].includes(text(offer.dealType)) ? text(offer.dealType) : native?.[2]?.toLowerCase() ?? route?.[1] ?? null;
  return { isCommercial, kind: kind as HousingType | null, deal: deal as RealEstateScraper.Listing["deal"] };
}

function correctCian(item: RealEstateScraper.Listing, offer: RecordValue): RealEstateScraper.Listing {
  const facts = evidence(offer, item.url);
  if (facts.isCommercial) return item;
  
  if (item.parentId) return item;
  if (!facts.kind) return { ...item, category: null, propertyType: null, deal: facts.deal };
  const rooms = number(offer.roomsCount);
  const kind = facts.kind === "flat" && (offer.isStudio === true || rooms === 0) ? "studio" : facts.kind;
  const labels: Record<HousingType, string> = { flat: "Квартира", studio: "Студия", room: "Комната", house: "Дом", cottage: "Коттедж", townhouse: "Таунхаус" };
  const terms = record(offer.bargainTerms);
  const price = number(terms.priceRur ?? terms.price);
  const area = number(offer.totalArea), floor = number(offer.floorNumber);
  const period = ({ monthly: "мес.", annually: "год", daily: "сутки" } as Record<string, string>)[text(terms.paymentPeriod)];
  const priceText = text(offer.formattedFullPrice) || text(offer.formattedShortPrice) ||
    (price !== null ? `${price} ₽${terms.priceType === "squareMeter" ? "/м²" : ""}${period ? `/${period}` : ""}` : "");
  return { ...item, category: "residential", propertyType: null,
    
    ...{ residentialType: kind, priceUnit: terms.priceType ?? null },
    title: text(offer.title) || labels[kind], rooms: kind === "studio" ? 0 : rooms,
    area, floor, floorType: floor === null ? null : floor > 0 ? "aboveGround" : "basement",
    price, priceText: period ? `${priceText} /${period}` : priceText, deal: facts.deal };
}


export function attachResidentialParsers(client: RealEstateScraper): void {
  const mir = client.parsers.mirkvartir;
  const mirBuild = mir.buildSearchUrl.bind(mir);
  const novosibirskCity = (value: unknown): boolean =>
    typeof value === "string" && selectedLocations({ city: value }).some(l => l.kind !== "region");
  const regionSegment = encodeURIComponent("Новосибирская+область");
  mir.buildSearchUrl = (query: RealEstateScraper.Query = {}) => {
    if (!residential(query)) return Reflect.apply(mirBuild, mir, [query]);
    const nativeUrl = (query.sourceOptions?.mirkvartir as { url?: unknown } | undefined)?.url;
    if (typeof nativeUrl === "string" && nativeUrl.trim()) return Reflect.apply(mirBuild, mir, [query]);
    if (!novosibirskCity((query as { city?: unknown }).city)) return Reflect.apply(mirBuild, mir, [query]);
    const built = Reflect.apply(mirBuild, mir, [query]) as string;
    const url = new URL(built);
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return built;
    let first = "";
    try { first = decodeURIComponent(segments[0]!).toLocaleLowerCase("ru"); } catch { first = ""; }
    if (first === "новосибирская+область" || first === "новосибирская область") return url.toString();
    url.pathname = `/${regionSegment}/${segments.join("/")}${url.pathname.endsWith("/") ? "/" : ""}`;
    return url.toString().replace("/Новосибирская+область/", `/${regionSegment}/`);
  };
  const mirParse = mir.parsePage.bind(mir);
  mir.parsePage = (payload, url, query) => {
    const page = mirParse(payload, url, query);
    return { ...page, results: page.results.map(item => {
      const host = new URL(item.url).hostname;
      const deal = ["arenda.mirkvartir.ru", "arendadoma.mirkvartir.ru"].includes(host) ? "rent" as const : ["www.mirkvartir.ru", "dom.mirkvartir.ru"].includes(host) ? "sale" as const : item.deal;
      return { ...item, deal };
    }) };
  };
  const cian = client.parsers.cian, parse = cian.parsePage.bind(cian);
  cian.parsePage = (payload, url, query) => {
    
    const page = parse(payload, url, query);
    const offers = offersFromSsr(payload);
    if (!offers) return page;
    const byId = new Map(offers.map(offer => [String(offer.cianId ?? offer.id), offer]));
    return { ...page, results: page.results.map(item => {
      const offer = byId.get(item.parentId ?? item.id ?? "");
      if (!offer || item.parentId) return item;
      const quality = listingQuality(offer);
      const enriched = { ...item, rooms: quality.rooms ?? item.rooms,
        ...(quality.priceUnit ? { priceText: quality.priceUnit === "rub_m2_year" ? "₽/м² в год" : quality.priceUnit === "rub_m2_month" ? "₽/м² в месяц" : quality.priceUnit === "rub_year" ? "₽ в год" : "₽ в месяц" } : {}),
        ...(quality.rentalPeriod === "day" ? { priceText: "₽ за сутки" } : {}),
        ...(quality.apartments ? { isApartments: true } : {}) };
      return residential(query) ? correctCian(enriched, offer) : enriched;
    }) };
  };
  
  
  for (const source of ["avito", "domclick"] as const) {
    const parser = client.parsers[source];
    const build = parser.buildSearchUrl, search = parser.searchPage;
    const assertSupported = (query: RealEstateScraper.Query = {}) => {
      if (residential(query)) throw Object.assign(new Error(`${source}: residential parser contract is not verified`), { code: "UNSUPPORTED_FILTER", source });
    };
    parser.buildSearchUrl = (...args) => { assertSupported(args[0]); return Reflect.apply(build, parser, args); };
    parser.searchPage = async (...args) => { assertSupported(args[0]); return Reflect.apply(search, parser, args); };
  }
}
