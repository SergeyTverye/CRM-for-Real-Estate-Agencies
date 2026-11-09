import type RealEstateScraper from "real-estate-scrapper";
import type { SearchFilters, Source } from "../domain/types";
import { selectedLocations } from "../domain/geography";
import { resolveSourceDepth, type DepthOptions } from "./source-limits";
import { residentialRooms } from "../domain/housing";

const purposeMap = { retail: "retail", psn_universal: "freePurpose", free_purpose: "freePurpose", office: "office", production: "industrial", warehouse: "warehouse" } as const;
const cities = {
  "новосибирск": { slug: "novosibirsk", cian: 4897, avito: 641780, domclick: "8dea00e3-9aab-4d8e-887c-ef2aaa546456", mirkvartir: "MK_Town|106136" },
  "москва": { slug: "moskva", cian: 1, avito: 637640, domclick: "1d1463ae-c80f-4d19-9331-a1b68a85b553", mirkvartir: "MK_Region|77" },
} as const;


const mirLocationPath = (city: string): string => {
  const paths: Record<string, string> = { "Кольцово": "Кольцово+рабочий+поселок", "Краснообск": "Новосибирский+район/Краснообск+рабочий+поселок" };
  return ["Новосибирская+область", ...(city === "Новосибирская область" ? [] : (paths[city] ?? city).split("/"))].map(encodeURIComponent).join("/") + "/";
};

export function resolveSourceGeography(filters: SearchFilters, source: Source, sourceOptions?: RealEstateScraper.Query["sourceOptions"]) {
  const city = cities[filters.city.trim().toLocaleLowerCase("ru") as keyof typeof cities];
  const defaults: RealEstateScraper.SourceOptions = city ? {
    citySlug: city.slug,
    ...(source === "cian" ? { regionId: city.cian } : {}),
    ...(source === "avito" ? { locationId: city.avito } : {}),
    ...(source === "domclick" ? { address: city.domclick } : {}),
    ...(source === "mirkvartir" ? { locationIds: city.mirkvartir } : {}),
  } : {};
  const location = selectedLocations(filters)[0];
  const extra: RealEstateScraper.SourceOptions = location && !city ? {
    citySlug: source === "onrealt" && location.id === "koltsovo" ? "rabochij-poselok-koltcovo" : location.slug,
    ...(source === "mirkvartir" ? { url: `https://${filters.operation === "rent" ? "arendacre" : "cre"}.mirkvartir.ru/${mirLocationPath(location.city)}` } : {}),
  } : {};
  return { ...defaults, ...extra, ...sourceOptions?.[source] };
}

export const RESIDENTIAL_TYPES = ["flat", "studio", "room", "house", "cottage", "townhouse"] as const;
export type ResidentialType = typeof RESIDENTIAL_TYPES[number];
export function splitPurposes(purposes: SearchFilters["purposes"]): { commercial: Exclude<SearchFilters["purposes"][number], "residential">[]; residential: boolean } {
  return { commercial: purposes.filter((p): p is Exclude<SearchFilters["purposes"][number], "residential"> => p !== "residential"), residential: purposes.includes("residential") };
}
export function buildScraperQueries(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"], depth?: DepthOptions): RealEstateScraper.Query[] {
  const locations = selectedLocations(filters);
  if (filters.locations?.length || locations.length === 1 && locations[0]!.kind === "district") {
    return locations.flatMap(location => {
      if (source === "youla" && location.kind === "region") {
        
        return buildScraperQueries({ ...filters, locations: ["novosibirsk", "berdsk", "ob", "koltsovo", "krasnoobsk", "iskitim"] }, source, signal, sourceOptions, depth);
      }
      return buildScraperQueries({ ...filters, city: location.city, locations: undefined }, source, signal, sourceOptions, depth).map(query => {
        if (location.kind !== "district") return query;
        if (source === "mirkvartir") {
          const geo = query.sourceOptions?.mirkvartir ?? {};
          const lastSegment = geo.url ? decodeURIComponent(new URL(geo.url).pathname).split("/").filter(Boolean).at(-1) : undefined;
          const roomSuffix = lastSegment && ["Студии", "Однокомнатные", "Двухкомнатные", "Трехкомнатные"].includes(lastSegment) ? `${encodeURIComponent(lastSegment)}/` : "";
          const host = query.category === "commercial" ? filters.operation === "rent" ? "arendacre" : "cre" : ["house", "cottage"].includes(query.type ?? "") ? filters.operation === "rent" ? "arendadoma" : "dom" : filters.operation === "rent" ? "arenda" : "www";
          return { ...query, sourceOptions: { ...query.sourceOptions, mirkvartir: { ...geo, url: `https://${host}.mirkvartir.ru/${mirLocationPath("Новосибирск")}${encodeURIComponent("Советский")}/${roomSuffix || (query.type === "cottage" ? `${encodeURIComponent("Коттеджи")}/` : "")}` } } };
        }
        
        
        if (source === "youla") return { ...query, query: "Академгородок" };
        return source === "onrealt" ? { ...query, sourceOptions: { ...query.sourceOptions, onrealt: { ...query.sourceOptions?.onrealt, params: { ...query.sourceOptions?.onrealt?.params, location: JSON.stringify({ "3": ["112"] }) } } } } : query;
      });
    });
  }
  const { commercial, residential: purposeResidential } = splitPurposes(filters.purposes);
  const kinds = filters.propertyKinds ?? [];
  const residential = purposeResidential || kinds.length > 0;
  const wantsCommercial = commercial.length > 0 || kinds.includes("non_residential") || !kinds.length && !residential;
  const commercialQuery = (): RealEstateScraper.Query => {
    
    
    
    const types = commercial.length ? [...new Set(commercial.map(p => source === "onrealt" && p === "retail" ? "freePurpose" : purposeMap[p]))]
      : source === "onrealt" ? ["freePurpose", "office", "industrial", "warehouse"] as const : ["commercial"] as const;
    
    const { maxPages, limit } = resolveSourceDepth(source, depth);
    return { city: filters.city, category: "commercial", types: [...types], deal: filters.operation,
      sources: [source], areaMin: filters.areaFrom, areaMax: filters.areaTo, maxPages, limit, signal,
      sourceOptions: { ...sourceOptions, [source]: resolveSourceGeography(filters, source, sourceOptions) } };
  };
  const residentialQueries = (): RealEstateScraper.Query[] => {
    const { maxPages, limit } = resolveSourceDepth(source, depth);
    const geography = resolveSourceGeography(filters, source, sourceOptions);
    
    
    const types = kinds.length ? [...new Set(kinds.flatMap(k => k === "flat" || k === "apartments" || k === "non_residential" ? ["flat" as const] : k === "house" ? source === "youla" ? ["house" as const] : ["house" as const, "cottage" as const] : []))] : RESIDENTIAL_TYPES;
    return types.flatMap(type => {
      const counts = residentialRooms(filters) && ["flat", "studio"].includes(type) && !filters.rooms!.includes("4+") ? filters.rooms!.map(r => r === "studio" ? 0 : Number(r)) : undefined;
      
      const branches = counts && ["mirkvartir", "onrealt"].includes(source) ? counts.map(n => [n]) : [counts];
      return branches.map(rooms => ({ city: filters.city, category: "residential" as const, type, deal: filters.operation,
      ...(rooms && ["cian", "yandex", "youla", "onrealt"].includes(source) ? { rooms } : {}),
      sources: [source], maxPages, limit, signal,
      sourceOptions: { ...sourceOptions, [source]: source === "mirkvartir" && (geography.url || rooms) ? { ...geography, url: `https://${["house", "cottage"].includes(type) ? filters.operation === "rent" ? "arendadoma" : "dom" : filters.operation === "rent" ? "arenda" : "www"}.mirkvartir.ru/${mirLocationPath(filters.city)}${rooms ? `${encodeURIComponent(({ 0: "Студии", 1: "Однокомнатные", 2: "Двухкомнатные", 3: "Трехкомнатные" } as Record<number, string>)[rooms[0]!]!)}/` : type === "cottage" ? `${encodeURIComponent("Коттеджи")}/` : ""}` } : geography } }));
    });
  };
  if (residential && !wantsCommercial) return residentialQueries();
  if (!residential) return [commercialQuery()];
  return [commercialQuery(), ...residentialQueries()];
}
export function buildScraperQuery(filters: SearchFilters, source: Source, signal: AbortSignal, sourceOptions?: RealEstateScraper.Query["sourceOptions"], depth?: DepthOptions): RealEstateScraper.Query {
  
  return buildScraperQueries(filters, source, signal, sourceOptions, depth)[0]!;
}

type TechnicalError = { code?: string; status?: number; error?: string; types?: RealEstateScraper.PropertyType[] };
export function classifyScraperErrors(errors: TechnicalError[]): "blocked" | "timeout" | "unsupported_filter" | "error" {
  if (errors.some(e => e.code === "ACCESS_BLOCKED" || [401, 403, 429].includes(e.status ?? 0))) return "blocked";
  if (errors.some(e => /TIMEOUT|ABORTED|ETIMEDOUT/u.test(e.code ?? ""))) return "timeout";
  if (errors.length && errors.every(e => ["UNSUPPORTED_FILTER", "DISTRICT_RESOLUTION_REQUIRED", "DISTRICT_LOOKUP_FAILED", "DISTRICT_NOT_FOUND", "UNSUPPORTED_LOCATION", "NOT_APPLICABLE", "LOCATION_REQUIRED", "LOCATION_NOT_FOUND"].includes(e.code ?? ""))) return "unsupported_filter";
  return "error";
}


export function scraperErrorReason(error: TechnicalError): string {
  const code = /^[A-Z_0-9]{1,60}$/u.test(error.code ?? "") ? error.code! : "SCRAPER_ERROR";
  const fields = ["city", "location", "types", "type", "areaMin", "areaMax", "floorMode", "owner", "districts", "regionId", "address", "locationId", "locationIds"];
  const field = fields.find(key => new RegExp(`\\b${key}\\b`, "u").test(error.error ?? ""));
  const types = error.types?.filter(t => ["commercial", "office", "retail", "freePurpose", "industrial", "warehouse", "building",
    "flat", "studio", "room", "house", "cottage", "townhouse", "land", "garage", "residential"].includes(t));
  const smokeReason = ["SMOKE_REQUEST_BUDGET", "SMOKE_REDIRECT_STOPPED"].find(value => error.error === value);
  const challenge = error.error === "CIAN_ACCESS_CHALLENGE" ? "; CIAN_ACCESS_CHALLENGE (CAPTCHA/антибот)" : "";
  if (["DISTRICT_LOOKUP_FAILED", "DISTRICT_NOT_FOUND"].includes(code)) return `${code}: площадка не смогла определить выбранный район. Расширьте локацию до города или выберите другую площадку.`;
  if (["UNSUPPORTED_LOCATION", "LOCATION_NOT_FOUND"].includes(code)) return "Локация не поддерживается площадкой. Выберите Новосибирский район или область и проверьте адрес объявления.";
  if (code === "NEEDS_USER_ACTION") return "NEEDS_USER_ACTION: площадка требует проверки браузера/CAPTCHA; откройте площадку вручную или используйте официальный импорт";
  return `${code}${error.status ? ` HTTP ${error.status}` : ""}${field ? `; фильтр: ${field}` : ""}${types?.length ? `; назначения: ${types.join(", ")}` : ""}${smokeReason ? `; ${smokeReason}` : ""}${challenge}`;
}
