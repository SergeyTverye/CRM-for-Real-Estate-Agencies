import { z } from "zod";
import { LOCATION_IDS, SEARCH_LOCATIONS } from "@/modules/property-search/domain/geography";
import { PURPOSES } from "@/modules/property-search/domain/types";
import { parseResultSchema } from "./contracts";
import { decodeAiJson } from "./decode-json";


export const PROVIDER_PURPOSE_ALLOWLIST: readonly string[] = [...new Set([...PURPOSES, "residential"])];

const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const strings = { type: "array", items: { type: "string" } };

export const providerParseSchema = {
  type: "object", additionalProperties: false,
  properties: {
    city: nullableText, operation: nullableText, priceUnit: nullableText,
    priceFrom: nullableText, priceTo: nullableText, areaFrom: nullableNumber, areaTo: nullableNumber,
    floorMode: nullableText, seller: nullableText,
    locations: strings, propertyKinds: strings, rooms: strings, purposes: strings, districts: strings, requiredFeatures: strings, preferredFeatures: strings, sources: strings,
    clarificationQuestion: nullableText,
  },
  required: ["city", "operation", "priceUnit", "priceFrom", "priceTo", "areaFrom", "areaTo", "floorMode", "seller",
    "locations", "propertyKinds", "rooms", "purposes", "districts", "requiredFeatures", "preferredFeatures", "sources", "clarificationQuestion"],
};
const flatSchema = z.object({
  locations: z.array(z.string()).nullish(), propertyKinds: z.array(z.string()).nullish(), rooms: z.array(z.string()).nullish(),
  city: z.string().nullish(), operation: z.string().nullish(), priceUnit: z.string().nullish(),
  priceFrom: z.string().nullish(), priceTo: z.string().nullish(), areaFrom: z.number().nullish(), areaTo: z.number().nullish(),
  floorMode: z.string().nullish(), seller: z.string().nullish(),
  purposes: z.array(z.string()).nullish(), districts: z.array(z.string()).nullish(),
  requiredFeatures: z.array(z.string()).nullish(), preferredFeatures: z.array(z.string()).nullish(), sources: z.array(z.string()).nullish(),
  clarificationQuestion: z.string().nullish(),
}).strict();

function canonicalParseResult(value: unknown) {
  const result = parseResultSchema.parse(value);
  if (!result.filters) return result;
  const filters = result.filters;
  if (filters.locations?.length === 1) filters.city = SEARCH_LOCATIONS.find(l => l.id === filters.locations![0])!.city;
  if (filters.propertyKinds?.length === 1 && filters.propertyKinds[0] === "non_residential" && filters.purposes.some(p => p !== "residential")) delete filters.propertyKinds;
  return result;
}
export function decodeParseResult(text: string) {
  const object = decodeAiJson(z.record(z.string(), z.unknown()), text);
  
  
  if ("filters" in object) return canonicalParseResult(object);
  const { clarificationQuestion, ...flat } = flatSchema.parse(object);
  if (clarificationQuestion != null) return parseResultSchema.parse({ filters: null, clarificationQuestion });
  const filters = Object.fromEntries(Object.entries(flat).filter(([key, value]) => value !== null && value !== undefined && (!(["locations", "propertyKinds", "rooms"].includes(key)) || !Array.isArray(value) || value.length > 0))) as Record<string, unknown>;
  
  
  
  if (filters.operation == null) return { filters: null, clarificationQuestion: "Уточните операцию: продажа или аренда?" };
  if (filters.operation === "rent" && filters.priceUnit == null) {
    if (filters.priceFrom !== undefined || filters.priceTo !== undefined) filters.priceUnit = "rub_month";
    else return { filters: null, clarificationQuestion: "Уточните единицу цены аренды: в месяц, в год или за м²?" };
  }
  if (filters.operation === "sale" && filters.priceUnit != null && filters.priceUnit !== "rub_total") filters.priceUnit = "rub_total";
  return canonicalParseResult({ filters, clarificationQuestion: null });
}
export const providerParseInstructions = `Верни ПЛОСКИЙ JSON по переданной text.format schema, без поля filters.
operation: sale/rent; priceUnit: rub_total/rub_month/rub_year/rub_m2_month/rub_m2_year.
locations: ${LOCATION_IDS.join("/")} (несколько = ИЛИ). suburbs = Новосибирск и пригороды, akademgorodok = Академгородок (Советский район), berdsk = Бердск, ob = город Обь (также «у Оби»), koltsovo = Кольцово, novosibirsk-region = область целиком. city согласуй с локацией; несколько локаций — city=Новосибирск.
propertyKinds: flat/house/apartments/non_residential; квартира/двушка = flat, дом/коттедж = house, апартаменты = apartments (нежилое), любое нежилое = non_residential. Для этих типов purposes=[], для офиса/склада используй purposes и propertyKinds=[].
Метры/метров после размера склада или офиса — площадь м². «В месяц» означает rent/rub_month даже без слова аренда.
rooms: массив строк studio/1/2/3/4+ (несколько = ИЛИ). Двушка/двухкомнатная = ["2"], однушка = ["1"], трёшка/трехкомнатная = ["3"], студия = ["studio"], четыре и более = ["4+"]. Для них propertyKinds=["flat"]. Не дублируй комнаты в requiredFeatures. Без указания комнат rooms=[].
purposes: ${PROVIDER_PURPOSE_ALLOWLIST.join("/")}.
floorMode: first_floor_only/exclude_basement_and_semi_basement/any; seller: all/confirmed_owner_only.
sources: cian/mirkvartir/onrealt/domclick/yandex/youla/avito (все, если не ограничены запросом).
Неизвестные скалярные границы = null, отсутствующие признаки = []. Цена — десятичная строка рублей.
Если критическое условие неясно, clarificationQuestion — вопрос на русском, operation=null; иначе clarificationQuestion=null.
Новосибирск по умолчанию. Последующая фраза меняет currentFilters, остальные условия сохраняются.
Явные «любые районы» / «все районы» снимают прежнее ограничение: districts=[]. «Любой этаж» задаёт floorMode=any; «все продавцы» — seller=all.
«Новый поиск» означает новый набор условий: не переноси неупомянутые ограничения currentFilters. «Добавь»/«исключи» уточняют текущий поиск.
Исключение цоколя при уже выбранном строго первом этаже НЕ снимает first_floor_only: сохраняй более строгое условие, если пользователь явно не просит его ослабить.
Назначения/районы — ИЛИ, группы — И. Результат требует подтверждения пользователем.`;
