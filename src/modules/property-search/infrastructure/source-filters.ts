import type RealEstateScraper from "real-estate-scrapper";
import type { SearchFilters, Source } from "../domain/types";

const purposeMap = { retail: "retail", psn_universal: "freePurpose", free_purpose: "freePurpose", office: "office", production: "industrial", warehouse: "warehouse" } as const;
const cities = {
  "новосибирск": { slug: "novosibirsk", cian: 4897, avito: 641780, domclick: "8dea00e3-9aab-4d8e-887c-ef2aaa546456", mirkvartir: "MK_Town|106136" },
  "москва": { slug: "moskva", cian: 1, avito: 637640, domclick: "1d1463ae-c80f-4d19-9331-a1b68a85b553", mirkvartir: "MK_Region|77" },
} as const;

/** Site IDs are independent namespaces. Trusted server options override defaults. */
export function buildScraperQuery(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"]): RealEstateScraper.Query {
  const city = cities[filters.city.trim().toLocaleLowerCase("ru") as keyof typeof cities];
  const defaults: RealEstateScraper.SourceOptions = city ? {
    citySlug: city.slug,
    ...(source === "cian" ? { regionId: city.cian } : {}),
    ...(source === "avito" ? { locationId: city.avito } : {}),
    ...(source === "domclick" ? { address: city.domclick } : {}),
    ...(source === "mirkvartir" ? { locationIds: city.mirkvartir } : {}),
  } : {};
  // OnRealt has no all-commercial route; searchSite splits these OR branches.
  const types = filters.purposes.length ? [...new Set(filters.purposes.map(p => purposeMap[p]))]
    : source === "onrealt" ? ["retail", "freePurpose", "office", "industrial", "warehouse"] as const : ["commercial"] as const;
  // Price, floor, ownership and districts remain local to preserve unknown candidates.
  return { city: filters.city, category: "commercial", types: [...types], deal: filters.operation,
    sources: [source], areaMin: filters.areaFrom, areaMax: filters.areaTo, maxPages: 2, limit: 100, signal,
    sourceOptions: { ...sourceOptions, [source]: { ...defaults, ...sourceOptions?.[source] } } };
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
  const types = error.types?.filter(t => ["commercial", "office", "retail", "freePurpose", "industrial", "warehouse", "building"].includes(t));
  const smokeReason = ["SMOKE_REQUEST_BUDGET", "SMOKE_REDIRECT_STOPPED"].find(value => error.error === value);
  return `${code}${error.status ? ` HTTP ${error.status}` : ""}${field ? `; фильтр: ${field}` : ""}${types?.length ? `; назначения: ${types.join(", ")}` : ""}${smokeReason ? `; ${smokeReason}` : ""}`;
}
