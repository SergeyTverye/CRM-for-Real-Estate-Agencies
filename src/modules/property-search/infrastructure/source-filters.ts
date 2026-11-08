import type RealEstateScraper from "real-estate-scrapper";
import type { SearchFilters, Source } from "../domain/types";
import { resolveSourceDepth, type DepthOptions } from "./source-limits";

const purposeMap = { retail: "retail", psn_universal: "freePurpose", free_purpose: "freePurpose", office: "office", production: "industrial", warehouse: "warehouse" } as const;
const cities = {
  "новосибирск": { slug: "novosibirsk", cian: 4897, avito: 641780, domclick: "8dea00e3-9aab-4d8e-887c-ef2aaa546456", mirkvartir: "MK_Town|106136" },
  "москва": { slug: "moskva", cian: 1, avito: 637640, domclick: "1d1463ae-c80f-4d19-9331-a1b68a85b553", mirkvartir: "MK_Region|77" },
} as const;

/** Site IDs are independent namespaces. Trusted server options override defaults. */
export function resolveSourceGeography(filters: SearchFilters, source: Source, sourceOptions?: RealEstateScraper.Query["sourceOptions"]) {
  const city = cities[filters.city.trim().toLocaleLowerCase("ru") as keyof typeof cities];
  const defaults: RealEstateScraper.SourceOptions = city ? {
    citySlug: city.slug,
    ...(source === "cian" ? { regionId: city.cian } : {}),
    ...(source === "avito" ? { locationId: city.avito } : {}),
    ...(source === "domclick" ? { address: city.domclick } : {}),
    ...(source === "mirkvartir" ? { locationIds: city.mirkvartir } : {}),
  } : {};
  return { ...defaults, ...sourceOptions?.[source] };
}
/** Жилая — отдельная категория площадки, а не коммерческий подтип.
 * Пакет real-estate-scrapper 2.1 отклоняет types:["residential"]
 * (types принимает только коммерческие подтипы); жилые запросы используют
 * category:"residential" + type — один тип на запрос. Пустой набор означает «вся жилая». */
export const RESIDENTIAL_TYPES = ["flat", "studio", "room", "house", "cottage", "townhouse"] as const;
export type ResidentialType = typeof RESIDENTIAL_TYPES[number];
export function splitPurposes(purposes: SearchFilters["purposes"]): { commercial: Exclude<SearchFilters["purposes"][number], "residential">[]; residential: boolean } {
  return { commercial: purposes.filter((p): p is Exclude<SearchFilters["purposes"][number], "residential"> => p !== "residential"), residential: purposes.includes("residential") };
}
export function buildScraperQueries(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"], depth?: DepthOptions): RealEstateScraper.Query[] {
  const { commercial, residential } = splitPurposes(filters.purposes);
  const commercialQuery = (): RealEstateScraper.Query => {
    // OnRealt has no all-commercial route; searchSite splits these OR branches.
    // OnRealt's retail routes return 404. Its public navigation exposes PSN for
    // both operations; retain the requested retail purpose in the local evaluator.
    const types = commercial.length ? [...new Set(commercial.map(p => source === "onrealt" && p === "retail" ? "freePurpose" : purposeMap[p]))]
      : source === "onrealt" ? ["freePurpose", "office", "industrial", "warehouse"] as const : ["commercial"] as const;
    // Price, floor, ownership and districts remain local to preserve unknown candidates.
    const { maxPages, limit } = resolveSourceDepth(source, depth);
    return { city: filters.city, category: "commercial", types: [...types], deal: filters.operation,
      sources: [source], areaMin: filters.areaFrom, areaMax: filters.areaTo, maxPages, limit, signal,
      sourceOptions: { ...sourceOptions, [source]: resolveSourceGeography(filters, source, sourceOptions) } };
  };
  const residentialQueries = (): RealEstateScraper.Query[] => {
    const { maxPages, limit } = resolveSourceDepth(source, depth);
    const geography = resolveSourceGeography(filters, source, sourceOptions);
    // Один запрос на жилой тип: пакет не принимает types:["residential"] и не
    // выражает несколько жилых типов одним URL (nativeMultiType — только коммерция).
    return RESIDENTIAL_TYPES.map(type => ({ city: filters.city, category: "residential" as const, type, deal: filters.operation,
      sources: [source], areaMin: filters.areaFrom, areaMax: filters.areaTo, maxPages, limit, signal,
      sourceOptions: { ...sourceOptions, [source]: geography } }));
  };
  if (residential && !commercial.length) return residentialQueries();
  if (!residential) return [commercialQuery()];
  return [commercialQuery(), ...residentialQueries()];
}
export function buildScraperQuery(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"], depth?: DepthOptions): RealEstateScraper.Query {
  // Backward-compatible single query: mixed selections start from the commercial branch.
  return buildScraperQueries(filters, source, signal, sourceOptions, depth)[0]!;
}

type TechnicalError = { code?: string; status?: number; error?: string; types?: RealEstateScraper.PropertyType[] };
export function classifyScraperErrors(errors: TechnicalError[]): "blocked" | "timeout" | "unsupported_filter" | "error" {
  if (errors.some(e => e.code === "ACCESS_BLOCKED" || [401, 403, 429].includes(e.status ?? 0))) return "blocked";
  if (errors.some(e => /TIMEOUT|ABORTED|ETIMEDOUT/u.test(e.code ?? ""))) return "timeout";
  if (errors.length && errors.every(e => ["UNSUPPORTED_FILTER", "DISTRICT_RESOLUTION_REQUIRED", "NOT_APPLICABLE", "LOCATION_REQUIRED", "LOCATION_NOT_FOUND"].includes(e.code ?? ""))) return "unsupported_filter";
  return "error";
}

/** Never return arbitrary upstream error text: it may contain listing data. */
export function scraperErrorReason(error: TechnicalError): string {
  const code = /^[A-Z_0-9]{1,60}$/u.test(error.code ?? "") ? error.code! : "SCRAPER_ERROR";
  const fields = ["city", "location", "types", "type", "areaMin", "areaMax", "floorMode", "owner", "districts", "regionId", "address", "locationId", "locationIds"];
  const field = fields.find(key => new RegExp(`\\b${key}\\b`, "u").test(error.error ?? ""));
  const types = error.types?.filter(t => ["commercial", "office", "retail", "freePurpose", "industrial", "warehouse", "building",
    "flat", "studio", "room", "house", "cottage", "townhouse", "land", "garage", "residential"].includes(t));
  const smokeReason = ["SMOKE_REQUEST_BUDGET", "SMOKE_REDIRECT_STOPPED"].find(value => error.error === value);
  const challenge = error.error === "CIAN_ACCESS_CHALLENGE" ? "; CIAN_ACCESS_CHALLENGE (CAPTCHA/антибот)" : "";
  if (code === "NEEDS_USER_ACTION") return "NEEDS_USER_ACTION: площадка требует проверки браузера/CAPTCHA; откройте площадку вручную или используйте официальный импорт";
  return `${code}${error.status ? ` HTTP ${error.status}` : ""}${field ? `; фильтр: ${field}` : ""}${types?.length ? `; назначения: ${types.join(", ")}` : ""}${smokeReason ? `; ${smokeReason}` : ""}${challenge}`;
}
