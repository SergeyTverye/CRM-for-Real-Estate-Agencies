import { createHash } from "node:crypto";
import type { SearchFilters } from "@/modules/property-search/domain/types";
import { sanitizeFactContacts } from "./p2-drafts";
import { FEATURE_DEFINITIONS, type FeatureKey } from "@/modules/property-search/domain/filter-catalog";

export const ANALYSIS_WARNING = "Сведения объявления не заменяют проверку сотрудником. Собственник и актуальная доступность не подтверждены ИИ. Неизвестные факты требуют уточнения.";
export function safeListingText(text: string) {
  return sanitizeFactContacts(text).replace(/(?:паспорт|кем выдан|регистраци[яи]|дата рождения)[^\n;]*/giu, "[REDACTED]").slice(0, 20000);
}
export function analysisCacheKey(description: string, criteria: string[], model: string) {
  return createHash("sha256").update(JSON.stringify(["listing-analysis-v31.1", description, [...new Set(criteria)].sort(), model])).digest("hex");
}
export function forbiddenAnalysisCriterion(criterion: string) {
  return /owner|seller|availability|собствен|владел|продавец|актуальн|доступност|свободно/iu.test(criterion);
}
/** A refinement may change only explicitly mentioned categories; defaults returned by
 * a model must never erase unrelated constraints. Full reset is an explicit phrase. */
export function preserveSearchConditions(previous: SearchFilters, proposed: SearchFilters, query: string): SearchFilters {
  if (/новый поиск|начни заново|сбрось все/iu.test(query)) return proposed;
  const next = { ...previous };
  const mentions: Partial<Record<keyof SearchFilters, RegExp>> = {
    city: /город|новосибир|москв|санкт|томск|омск/iu,
    operation: /аренд|продаж|купить|покуп/iu, priceUnit: /аренд|цен|бюджет|руб|месяц|год|м²/iu,
    purposes: /офис|склад|псн|торгов|производ|назначен/iu,
    districts: /район|центральн|советск|ленинск|кировск|октябрьск|заельцовск/iu,
    priceFrom: /цен|бюджет|руб|стоим/iu, priceTo: /цен|бюджет|руб|стоим/iu,
    areaFrom: /площад|м²|кв\.?\s*м/iu, areaTo: /площад|м²|кв\.?\s*м/iu,
    floorMode: /этаж|подвал|цокол/iu, floorFrom: /этаж/iu, floorTo: /этаж/iu,
    seller: /собствен|продав|агент|посредник/iu, sources: /источник|площадк|циан|авито|яндекс|домклик|юла/iu,
    hasPhotos: /фото/iu, freshness: /свеж|опубликов|найден|дн[яей]|час/iu,
    verification: /провер/iu,
  };
  for (const key of Object.keys(mentions) as (keyof SearchFilters)[]) {
    if (mentions[key]?.test(query)) Object.assign(next, { [key]: proposed[key] });
  }
  if (/вход|витрин|лини|мокр|мощност|квт|потол|ворот|разгруз|парков|арендатор|признак|особенност/iu.test(query)) {
    if (previous.features || proposed.features) next.features = { ...previous.features, ...proposed.features };
    next.requiredFeatures = [...new Set([...previous.requiredFeatures, ...proposed.requiredFeatures])];
    next.preferredFeatures = [...new Set([...previous.preferredFeatures, ...proposed.preferredFeatures])];
    if (/убери|сними|не треб|без требования/iu.test(query)) {
      const mentioned = (criterion:string) => criterion.toLocaleLowerCase("ru").split(/[^\p{L}\d]+/u).filter(word=>word.length>3).some(word=>query.toLocaleLowerCase("ru").includes(word.slice(0,5)));
      next.requiredFeatures = previous.requiredFeatures.filter(c=>!mentioned(c));
      next.preferredFeatures = previous.preferredFeatures.filter(c=>!mentioned(c));
      if (previous.features) next.features = Object.fromEntries(Object.entries(previous.features).filter(([key])=>!mentioned(FEATURE_DEFINITIONS[key as FeatureKey].label)));
    }
  }
  if (previous.floorMode === "first_floor_only" && /(?:исключи|без).*цокол/iu.test(query) && !/не только перв|любой этаж/iu.test(query)) next.floorMode = "first_floor_only";
  return next;
}
export function analysisCriterionLabel(criterion:string):string {
  if (criterion.startsWith("features.")) return FEATURE_DEFINITIONS[criterion.slice(9) as FeatureKey]?.label ?? "Дополнительная характеристика";
  return ({city:"Город",operation:"Операция",purpose:"Назначение",priceUnit:"Единица цены",price:"Цена",area:"Площадь",floor:"Этаж",floorRange:"Диапазон этажей",district:"Район",owner:"Проверка собственника",seller:"Продавец",photos:"Фотографии",verification:"Проверка сотрудником",freshness:"Свежесть"} as Record<string,string>)[criterion] ?? criterion;
}
export function filterDiff(before: SearchFilters, after: SearchFilters) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key => {
    const field = key as keyof SearchFilters;
    return JSON.stringify(before[field]) === JSON.stringify(after[field]) ? [] : [{ field, before: before[field] ?? null, after: after[field] ?? null }];
  });
}
