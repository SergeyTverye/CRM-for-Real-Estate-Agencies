import { compareMoney, type CriterionEvaluation, type DescriptionAnalyzer, type ListingEvaluation, type NormalizedListing, type SearchFilters } from "./types";
import { normalizeGeography, resolveDistrict } from "./geography";
import { residentialPurposeContradiction } from "./purpose";
import { convertPrice } from "./prices";
import { freshnessState } from "./freshness";
import { FEATURE_DEFINITIONS, type FeatureKey } from "./filter-catalog";

const featureRules = [
  { key: "separate_entrance", request: /отдельн\S*\s+вход/iu, fact: /отдельн\S*\s+вход\S*/iu },
  { key: "shop_window", request: /витрин/iu, fact: /витрин\S*/iu },
  { key: "first_line", request: /перв\S*\s+лини/iu, fact: /(?:перв\S*|1[- ]?я)\s+лини\S*/iu },
  { key: "wet_point", request: /мокр\S*\s+точк/iu, fact: /мокр\S*\s+точк\S*/iu },
  { key: "parking", request: /парков/iu, fact: /парков\S*/iu },
  { key: "unloading", request: /разгруз/iu, fact: /разгруз\S*/iu },
  { key: "tenant", request: /арендатор/iu, fact: /арендатор\S*/iu },
  { key: "vacant", request: /свободно/iu, fact: /свободно/iu },
  { key: "gates", request: /ворот/iu, fact: /ворот\S*/iu },
  { key: "power_kw", request: /мощност|квт/iu, fact: /(?:мощност\S*\s*[:—-]?\s*)?(\d+(?:[.,]\d+)?)\s*квт/iu },
  { key: "ceiling_m", request: /потол/iu, fact: /потол\S*\s*(?:высот\S*\s*)?[:—-]?\s*(\d+(?:[.,]\d+)?)\s*м/iu },
];
const unknown = (criterion: string, evidence = "Нет подтверждающих сведений"): CriterionEvaluation => ({ criterion, state: "unknown", source: "rule", evidence });
export function evaluateFeature(criterion: string, listing: NormalizedListing): CriterionEvaluation {
  const rule = featureRules.find(r => r.request.test(criterion));
  const requestedNumber = criterion.match(/\d+(?:[.,]\d+)?/u)?.[0];
  const minimum = requestedNumber ? Number(requestedNumber.replace(",", ".")) : null;
  const key = rule?.key ?? criterion;
  const structured = listing.structuredFeatures[key];
  if (typeof structured === "boolean") return { criterion, state: structured ? "matched" : "contradicted", source: "structured", evidence: `${key}=${structured}` };
  if (typeof structured === "number" && minimum !== null) return { criterion, state: structured >= minimum ? "matched" : "contradicted", source: "structured", evidence: `${key}=${structured}` };
  if (!rule) return unknown(criterion);
  const evidence: CriterionEvaluation[] = [];
  for (const clause of listing.description.split(/[;!?\n]|(?<!\d)\.|\.(?!\d)|,(?!\d)/u)) {
    const match = rule.fact.exec(clause);
    if (!match) continue;
    const prefix = clause.slice(0, match.index);
    const suffix = clause.slice(match.index + match[0].length);
    const negated = /(?:^|\s)(?:нет|без|не|отсутствует|отсутствуют)\s*(?:\S+\s+){0,2}$/iu.test(prefix) || /^\s*(?:нет|отсутствует|отсутствуют|не\s+(?:имеется|предусмотрен|оборудован|планиру|будет|будут|возмож))/iu.test(suffix);
    // Explicit absence wins over hypothetical/future language in the same clause.
    if (!negated && /можно|возможн|планиру|проект|перспектив|будет|будут|при\s+необходимости/iu.test(clause)) continue;
    const numeric = match[1] ? Number(match[1].replace(",", ".")) : null;
    evidence.push({ criterion, source: "rule", evidence: clause.trim(), state: negated || (minimum !== null && numeric !== null && numeric < minimum) ? "contradicted" : minimum !== null && numeric === null ? "unknown" : "matched" });
  }
  return evidence.find(e => e.state === "contradicted") ?? evidence.find(e => e.state === "matched") ?? unknown(criterion);
}

function summarize(criteria: CriterionEvaluation[], preferences: CriterionEvaluation[]): ListingEvaluation {
  return {
    verdict: criteria.some(c => c.state === "contradicted") ? "rejected" : criteria.some(c => c.state === "unknown") ? "needs_review" : "confirmed",
    criteria, preferences,
    score: preferences.length ? Math.round(100 * preferences.filter(c => c.state === "matched").length / preferences.length) : 0,
    aiPending: [...criteria, ...preferences].filter(c => c.state === "unknown" && c.source === "rule").map(c => c.criterion),
  };
}
export function evaluateListing(listing: NormalizedListing, filters: SearchFilters, now = new Date()): ListingEvaluation {
  const criteria: CriterionEvaluation[] = [];
  const add = (criterion: string, known: boolean, matches: boolean, evidence: string) => criteria.push({ criterion, state: !known ? "unknown" : matches ? "matched" : "contradicted", source: "structured", evidence });
  add("city", !!listing.city, normalizeGeography(listing.city ?? "") === normalizeGeography(filters.city), listing.city ?? "Город неизвестен");
  add("operation", !!listing.operation, listing.operation === filters.operation, listing.operation ?? "Операция неизвестна");
  const residentialPurpose = residentialPurposeContradiction(listing);
  if (residentialPurpose) criteria.push(residentialPurpose);
  else if (filters.purposes.length) add("purpose", !!listing.purpose, filters.purposes.some(p => p === listing.purpose || (["psn_universal", "free_purpose"].includes(p) && ["psn_universal", "free_purpose"].includes(listing.purpose ?? ""))), listing.purpose ?? "Назначение неизвестно");
  if (filters.operation === "rent" || filters.priceFrom !== undefined || filters.priceTo !== undefined) {
    const unit = filters.operation === "sale" ? "rub_total" : filters.priceUnit;
    const converted = unit ? convertPrice(listing.price, listing.priceUnit, unit, listing.area) : null;
    add("priceUnit", !!converted, !!converted, converted?.basis ?? "Несовместимые или неизвестные единицы цены");
    if (filters.priceFrom !== undefined || filters.priceTo !== undefined) add("price", !!converted, !!converted && (filters.priceFrom === undefined || compareMoney(converted.amount, filters.priceFrom) >= 0) && (filters.priceTo === undefined || compareMoney(converted.amount, filters.priceTo) <= 0), converted ? `${converted.amount} ${unit}; ${converted.basis}` : "Цена не может быть рассчитана");
  }
  if (filters.areaFrom !== undefined || filters.areaTo !== undefined) add("area", listing.area !== null, listing.area !== null && (filters.areaFrom === undefined || listing.area >= filters.areaFrom) && (filters.areaTo === undefined || listing.area <= filters.areaTo), String(listing.area ?? "Площадь неизвестна"));
  if (filters.floorMode !== "any") add("floor", listing.floor.kind !== "unknown", listing.floor.kind === "above_ground" && (filters.floorMode !== "first_floor_only" || listing.floor.number === 1), listing.floor.raw ?? "Этаж неизвестен");
  if (filters.districts.length) {
    const district = resolveDistrict(listing.city, listing.district, listing.address);
    add("district", !!district, filters.districts.some(d => normalizeGeography(d) === normalizeGeography(district ?? "")), district ?? "Район не установлен по географии");
  }
  if (filters.seller === "confirmed_owner_only") {
    const verification = listing.seller.ownerVerification;
    const verified = verification?.source === "employee" && !!verification.verifiedBy && !!verification?.source.trim() && !!verification?.method.trim() && Number.isFinite(Date.parse(verification?.checkedAt ?? ""));
    add("owner", verified || listing.seller.type === "agent", verified && listing.seller.type !== "agent", verified ? JSON.stringify(verification) : "Собственник не проверен");
  }
  if (filters.seller === "agent") add("seller", listing.seller.type !== "unknown", listing.seller.type === "agent", listing.seller.type);
  if (filters.hasPhotos !== undefined) add("photos", true, (listing.images.length > 0) === filters.hasPhotos, `${listing.images.length} фото`);
  if (filters.floorFrom !== undefined || filters.floorTo !== undefined) add("floorRange", listing.floor.number !== null, listing.floor.number !== null && (filters.floorFrom === undefined || listing.floor.number >= filters.floorFrom) && (filters.floorTo === undefined || listing.floor.number <= filters.floorTo), listing.floor.raw ?? "Этаж неизвестен");
  if (filters.verification && filters.verification !== "all") add("verification", true, !!listing.lastCheckedAt === (filters.verification === "checked"), listing.lastCheckedAt ?? "Не проверено");
  if (filters.freshness) {
    const at = filters.freshness.mode === "published" ? listing.publishedAt : listing.firstSeenAt;
    criteria.push({ criterion: "freshness", state: freshnessState(at, filters.freshness, now), source: "structured", evidence: at ?? "Дата неизвестна" });
  }
  for (const [key, condition] of Object.entries(filters.features ?? {})) {
    const label = FEATURE_DEFINITIONS[key as FeatureKey].label;
    const structured = listing.structuredFeatures[key];
    if (typeof condition === "boolean") {
      const fact: CriterionEvaluation = typeof structured === "boolean" ? { criterion: label, state: structured ? "matched" : "contradicted", source: "structured", evidence: `${key}=${structured}` } : evaluateFeature(label, listing);
      criteria.push({ ...fact, criterion: `features.${key}`, state: fact.state === "unknown" ? "unknown" : condition ? fact.state : fact.state === "matched" ? "contradicted" : "matched" });
    } else if (condition) {
      const fact: CriterionEvaluation = typeof structured === "number" && Number.isFinite(structured) ? { criterion: label, state: "matched", source: "structured", evidence: `${key}=${structured}` } : evaluateFeature(`${label} ${condition.min ?? 0}`, listing);
      // A numeric upper bound needs an actual measured value, never a boolean claim.
      const number = typeof structured === "number" ? structured : Number(fact.evidence.match(/(\d+(?:[.,]\d+)?)\s*(?:квт|м)/iu)?.[1]?.replace(",", "."));
      criteria.push({ criterion: `features.${key}`, state: fact.state === "contradicted" ? "contradicted" : fact.state === "unknown" || !Number.isFinite(number) ? "unknown" : (condition.min === undefined || number >= condition.min) && (condition.max === undefined || number <= condition.max) ? "matched" : "contradicted", source: fact.source, evidence: fact.evidence });
    }
  }
  criteria.push(...filters.requiredFeatures.map(c => evaluateFeature(c, listing)));
  return summarize(criteria, filters.preferredFeatures.map(c => evaluateFeature(c, listing)));
}
export function redactPublicDescription(description: string): string {
  return description.replace(/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}/giu, "[email]").replace(/(?:\+?\d[\s().-]*){10,15}/gu, "[телефон]");
}
export async function analyzeUnresolved(listing: NormalizedListing, evaluation: ListingEvaluation, analyzer: DescriptionAnalyzer, signal?: AbortSignal): Promise<ListingEvaluation> {
  // Typed ranges/negated boolean conditions already carry precise rules; AI cannot invent measurements.
  const permitted = new Set([...evaluation.criteria, ...evaluation.preferences].filter(c => c.source === "rule" && !c.criterion.startsWith("features.") && !["owner", "purpose", "freshness"].includes(c.criterion)).map(c => c.criterion));
  evaluation = { ...evaluation, aiPending: evaluation.aiPending.filter(c => permitted.has(c)) };
  if (!evaluation.aiPending.length) return evaluation;
  const description = redactPublicDescription(listing.description);
  const answers = await analyzer.analyze({ description, criteria: evaluation.aiPending, signal });
  const apply = (items: CriterionEvaluation[]) => items.map(item => {
    if (item.state !== "unknown" || !evaluation.aiPending.includes(item.criterion)) return item;
    const answer = answers.find(a => a.criterion === item.criterion && ["matched", "contradicted", "unknown"].includes(a.state) && a.evidence.trim() && description.includes(a.evidence));
    if (!answer) return item;
    // A quoted promise is evidence of uncertainty, never existing equipment.
    if (answer.state === "matched" && /можно|возможн|планиру|проект|перспектив|будет|будут|при\s+необходимости/iu.test(answer.evidence)) return item;
    return { ...answer, source: "ai" as const };
  });
  return summarize(apply(evaluation.criteria), apply(evaluation.preferences));
}
