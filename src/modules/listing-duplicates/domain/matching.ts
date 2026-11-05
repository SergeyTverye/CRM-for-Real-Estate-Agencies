/** Deterministic candidate detection. No rule constitutes proof of identity. */
export interface DuplicateCandidate {
  id: string; source: string; sourceListingId?: string | null; sourceUnitId?: string | null;
  city: string | null; address: string | null; area: number | null;
  floor: number | null; floorKind?: string; purposes: string[]; operation: string | null;
  price?: string | null; priceUnit?: string | null;
  features?: Record<string, boolean | number | string>;
}
export interface FeatureEvidence { feature: string; state: "matched" | "contradicted" | "unknown"; explanation: string }
export interface PairEvidence { a: string; b: string; score: number; probable: boolean; features: FeatureEvidence[] }
const clean = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
export function normalizeAddress(value: string | null, city: string | null = null) {
  let s = clean(value ?? "").replace(/[.,;]/g, " ");
  const cityKey = clean(city ?? "").replace(/^г(?:ород)?\.?\s+/, "");
  if (cityKey) s = s.replace(new RegExp(`^(?:г(?:ород)?\\s+)?${cityKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+|$)`), "");
  s = s.replace(/(?:^|\s)(?:пр-т|проспект|просп)(?=\s|$)/g, " проспект ")
    .replace(/(?:^|\s)(?:ул|улица)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(?:д|дом)(?=\s*\d)/g, " ")
    .replace(/(\d)\s*(?:корпус|корп|к)\s*(?=\d)/g, "$1 корпус ")
    .replace(/(?:строение|стр)\s*(?=\d)/g, "строение ")
    .replace(/(?:^|\s)(?:помещение|пом|офис|оф)\s*(?:№\s*)?(\d+[а-я/-]*|[а-я](?=\s|$))/g, " помещение $1")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2").replace(/(\d)\s+([а-я])(?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ").trim();
  const part = (name: string) => s.match(new RegExp(`${name}\\s+([\\dа-я/-]+)`))?.[1] ?? null;
  const corpus = part("корпус"), building = part("строение"), unit = part("помещение");
  const base = s.replace(/\s*(?:корпус|строение|помещение)\s+[\dа-я/-]+/g, "").trim();
  const house = base.match(/(?:^|\s)(\d+[а-я]?(?:\/\d+[а-я]?)?)$/)?.[1] ?? null;
  const street = (house ? base.slice(0, base.length - house.length) : base).trim();
  return { city: cityKey, street, house, corpus, building, unit };
}
export function areaWithinTolerance(a: number | null, b: number | null) {
  return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 &&
    Math.abs(a - b) <= Math.max(2, Math.max(a, b) * 0.03) + 1e-9;
}
export function compareListings(a: DuplicateCandidate, b: DuplicateCandidate): PairEvidence {
  const features: FeatureEvidence[] = [];
  const add = (feature: string, state: FeatureEvidence["state"], explanation: string) => features.push({ feature, state, explanation });
  const aa = normalizeAddress(a.address, a.city), bb = normalizeAddress(b.address, b.city);
  const eq = (feature: string, x: string | number | boolean | null | undefined, y: typeof x, required = false) => {
    const state = x === null || x === undefined || x === "" || y === null || y === undefined || y === "" ? "unknown" : x === y ? "matched" : "contradicted";
    add(feature, state, state === "matched" ? "Значения совпадают" : state === "unknown" ? "Недостаточно сведений" : "Значения различаются");
    return state !== "contradicted" && (!required || state === "matched");
  };
  let compatible = eq("Город", aa.city, bb.city, true);
  compatible = eq("Улица", aa.street, bb.street, true) && compatible;
  for (const [label, key] of [["Дом", "house"], ["Корпус", "corpus"], ["Строение", "building"], ["Помещение", "unit"]] as const)
    compatible = eq(label, aa[key], bb[key]) && compatible;
  compatible = eq("Операция", a.operation, b.operation) && compatible;
  compatible = eq("Этаж", a.floor, b.floor) && compatible;
  if (a.floorKind && b.floorKind && a.floorKind !== "unknown" && b.floorKind !== "unknown") compatible = eq("Тип этажа", a.floorKind, b.floorKind) && compatible;
  const area = areaWithinTolerance(a.area, b.area);
  add("Площадь", a.area === null || b.area === null ? "unknown" : area ? "matched" : "contradicted", "Допуск: максимум из 2 м² и 3% большей площади");
  const purpose = a.purposes.some(p => b.purposes.includes(p));
  const broad = [...a.purposes, ...b.purposes].some(p => ["psn_universal", "free_purpose"].includes(p));
  add("Назначение", purpose ? "matched" : !a.purposes.length || !b.purposes.length || broad ? "unknown" : "contradicted", purpose ? "Есть общее назначение" : "Общее назначение не подтверждено");
  if (a.purposes.length && b.purposes.length && !purpose && !broad) compatible = false;
  const floor = a.floor !== null && a.floor === b.floor;
  const unit = aa.unit !== null && aa.unit === bb.unit;
  const house = aa.house !== null && aa.house === bb.house;
  const price = !!a.price && a.price === b.price && !!a.priceUnit && a.priceUnit === b.priceUnit;
  add("Цена", price ? "matched" : "unknown", "Цена — вспомогательный признак, не доказательство идентичности");
  for (const key of ["separate_entrance", "ceiling_height", "power_kw", "gates", "wet_point", "first_line"])
    eq(`Признак: ${key}`, a.features?.[key], b.features?.[key]);
  // A missing house number is acceptable only with several independent structured corroborations.
  const incompleteAddress = !house && (!aa.house || !bb.house) && floor && purpose && price && a.area === b.area;
  // Floor/unit stated in only one listing is weak evidence: group only when the price corroborates (±5%, same unit).
  const missing = (x: unknown) => x === null || x === undefined || x === "";
  const asymmetric = missing(a.floor) !== missing(b.floor) || missing(aa.unit) !== missing(bb.unit);
  const pa = Number(a.price), pb = Number(b.price);
  const priceClose = !!a.price && !!b.price && !!a.priceUnit && a.priceUnit === b.priceUnit &&
    Number.isFinite(pa) && Number.isFinite(pb) && pa > 0 && pb > 0 && Math.abs(pa - pb) <= Math.max(pa, pb) * 0.05;
  if (asymmetric) add("Этаж/помещение", "unknown", priceClose
    ? "Этаж или помещение указан только в одном объявлении; совпадение поддержано близкой ценой (±5%)"
    : "Этаж или помещение указан только в одном объявлении; без подтверждения ценой группа не создаётся");
  const probable = compatible && area && (house || incompleteAddress) && (!asymmetric || priceClose);
  const score = !probable ? 0 : asymmetric || !house || (!floor && !unit) ? 35 : Math.min(90, 60 + (floor ? 15 : 0) + (unit ? 10 : 0) + (purpose ? 5 : 0));
  add("Вывод", probable ? "matched" : "contradicted", probable ? "Вероятное совпадение; требуется решение сотрудника" : "Недостаточно оснований для общей группы");
  return { a: a.id, b: b.id, probable, score, features };
}
/** Complete-link grouping prevents A~B~C chains from swallowing contradictory A/C units. */
export function groupCandidates(input: DuplicateCandidate[], blocked: (a: string, b: string) => boolean = () => false) {
  const groups: DuplicateCandidate[][] = [];
  const buckets = new Map<string, DuplicateCandidate[][]>();
  for (const item of [...input].sort((a, b) => a.id.localeCompare(b.id))) {
    const address = normalizeAddress(item.address, item.city);
    const key = JSON.stringify([address.city, address.street]);
    const bucket = buckets.get(key) ?? [];
    const group = bucket.find(g => g.every(other => !blocked(item.id, other.id) && compareListings(item, other).probable));
    if (group) group.push(item);
    else { const created = [item]; bucket.push(created); groups.push(created); }
    buckets.set(key, bucket);
  }
  return groups.filter(g => g.length > 1).map(g => ({ listingIds: g.map(x => x.id), pairs: g.flatMap((a, i) => g.slice(i + 1).map(b => compareListings(a, b))) }));
}
