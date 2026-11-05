import { compareMoney, type CriterionEvaluation, type DescriptionAnalyzer, type ListingEvaluation, type NormalizedListing, type SearchFilters } from "./types";
import { normalizeGeography, resolveDistrict } from "./geography";
import { residentialPurposeContradiction } from "./purpose";

const featureRules = [
  { key: "separate_entrance", request: /отдельн\S*\s+вход/iu, fact: /отдельн\S*\s+вход\S*/iu },
  { key: "shop_window", request: /витрин/iu, fact: /витрин\S*/iu },
  { key: "first_line", request: /перв\S*\s+лини/iu, fact: /(?:перв\S*|1[- ]?я)\s+лини\S*/iu },
  { key: "wet_point", request: /мокр\S*\s+точк/iu, fact: /мокр\S*\s+точк\S*/iu },
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
export function evaluateListing(listing: NormalizedListing, filters: SearchFilters): ListingEvaluation {
  const criteria: CriterionEvaluation[] = [];
  const add = (criterion: string, known: boolean, matches: boolean, evidence: string) => criteria.push({ criterion, state: !known ? "unknown" : matches ? "matched" : "contradicted", source: "structured", evidence });
  add("city", !!listing.city, normalizeGeography(listing.city ?? "") === normalizeGeography(filters.city), listing.city ?? "Город неизвестен");
  add("operation", !!listing.operation, listing.operation === filters.operation, listing.operation ?? "Операция неизвестна");
  const residentialPurpose = residentialPurposeContradiction(listing);
  if (residentialPurpose) criteria.push(residentialPurpose);
  else if (filters.purposes.length) add("purpose", !!listing.purpose, filters.purposes.some(p => p === listing.purpose || (["psn_universal", "free_purpose"].includes(p) && ["psn_universal", "free_purpose"].includes(listing.purpose ?? ""))), listing.purpose ?? "Назначение неизвестно");
  if (filters.operation === "rent" || filters.priceFrom !== undefined || filters.priceTo !== undefined) {
    const unit = filters.operation === "sale" ? "rub_total" : filters.priceUnit;
    add("priceUnit", !!listing.priceUnit, listing.priceUnit === unit, listing.priceUnit ?? "Единица цены неизвестна");
    // Different units are not converted implicitly. A known incompatible unit needs review.
    if (listing.priceUnit && listing.priceUnit !== unit) criteria[criteria.length - 1]!.state = "unknown";
    if (filters.priceFrom !== undefined || filters.priceTo !== undefined) add("price", listing.price !== null && listing.priceUnit === unit, listing.price !== null && (filters.priceFrom === undefined || compareMoney(listing.price, filters.priceFrom) >= 0) && (filters.priceTo === undefined || compareMoney(listing.price, filters.priceTo) <= 0), `${listing.price ?? "?"} ${listing.priceUnit ?? "?"}`);
  }
  if (filters.areaFrom !== undefined || filters.areaTo !== undefined) add("area", listing.area !== null, listing.area !== null && (filters.areaFrom === undefined || listing.area >= filters.areaFrom) && (filters.areaTo === undefined || listing.area <= filters.areaTo), String(listing.area ?? "Площадь неизвестна"));
  if (filters.floorMode !== "any") add("floor", listing.floor.kind !== "unknown", listing.floor.kind === "above_ground" && (filters.floorMode !== "first_floor_only" || listing.floor.number === 1), listing.floor.raw ?? "Этаж неизвестен");
  if (filters.districts.length) {
    const district = resolveDistrict(listing.city, listing.district, listing.address);
    add("district", !!district, filters.districts.some(d => normalizeGeography(d) === normalizeGeography(district ?? "")), district ?? "Район не установлен по географии");
  }
  if (filters.seller === "confirmed_owner_only") {
    const verification = listing.seller.ownerVerification;
    const verified = !!verification?.source.trim() && !!verification?.method.trim() && Number.isFinite(Date.parse(verification?.checkedAt ?? ""));
    add("owner", verified || listing.seller.type === "agent", verified && listing.seller.type !== "agent", verified ? JSON.stringify(verification) : "Собственник не проверен");
  }
  criteria.push(...filters.requiredFeatures.map(c => evaluateFeature(c, listing)));
  return summarize(criteria, filters.preferredFeatures.map(c => evaluateFeature(c, listing)));
}
export function redactPublicDescription(description: string): string {
  return description.replace(/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}/giu, "[email]").replace(/(?:\+?\d[\s().-]*){10,15}/gu, "[телефон]");
}
export async function analyzeUnresolved(listing: NormalizedListing, evaluation: ListingEvaluation, analyzer: DescriptionAnalyzer, signal?: AbortSignal): Promise<ListingEvaluation> {
  if (!evaluation.aiPending.length) return evaluation;
  const description = redactPublicDescription(listing.description);
  const answers = await analyzer.analyze({ description, criteria: evaluation.aiPending, signal });
  const apply = (items: CriterionEvaluation[]) => items.map(item => {
    if (item.state !== "unknown" || !evaluation.aiPending.includes(item.criterion)) return item;
    const answer = answers.find(a => a.criterion === item.criterion && ["matched", "contradicted", "unknown"].includes(a.state) && a.evidence.trim() && description.includes(a.evidence));
    return answer ? { ...answer, source: "ai" as const } : item;
  });
  return summarize(apply(evaluation.criteria), apply(evaluation.preferences));
}
