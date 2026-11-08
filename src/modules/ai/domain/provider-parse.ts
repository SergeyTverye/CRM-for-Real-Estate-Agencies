import { z } from "zod";
import { LOCATION_IDS } from "@/modules/property-search/domain/geography";
import { PURPOSES } from "@/modules/property-search/domain/types";
import { parseResultSchema } from "./contracts";
import { decodeAiJson } from "./decode-json";

/** Provider instruction allowlist mirrors domain PURPOSES; residential is required even before/after B lands. */
export const PROVIDER_PURPOSE_ALLOWLIST: readonly string[] = [...new Set([...PURPOSES, "residential"])];

const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const strings = { type: "array", items: { type: "string" } };
/** Provider dialect: flat, no refs/unions/defaults/formats/bounds. Business validation stays in Zod. */
export const providerParseSchema = {
  type: "object", additionalProperties: false,
  properties: {
    city: nullableText, operation: nullableText, priceUnit: nullableText,
    priceFrom: nullableText, priceTo: nullableText, areaFrom: nullableNumber, areaTo: nullableNumber,
    floorMode: nullableText, seller: nullableText,
    locations: strings, propertyKinds: strings, purposes: strings, districts: strings, requiredFeatures: strings, preferredFeatures: strings, sources: strings,
    clarificationQuestion: nullableText,
  },
  required: ["city", "operation", "priceUnit", "priceFrom", "priceTo", "areaFrom", "areaTo", "floorMode", "seller",
    "locations", "propertyKinds", "purposes", "districts", "requiredFeatures", "preferredFeatures", "sources", "clarificationQuestion"],
};
const flatSchema = z.object({
  locations: z.array(z.string()).optional(), propertyKinds: z.array(z.string()).optional(),
  city: z.string().nullable(), operation: z.string().nullable(), priceUnit: z.string().nullable(),
  priceFrom: z.string().nullable(), priceTo: z.string().nullable(), areaFrom: z.number().nullable(), areaTo: z.number().nullable(),
  floorMode: z.string().nullable(), seller: z.string().nullable(), purposes: z.array(z.string()), districts: z.array(z.string()),
  requiredFeatures: z.array(z.string()), preferredFeatures: z.array(z.string()), sources: z.array(z.string()),
  clarificationQuestion: z.string().nullable(),
}).strict();
export function decodeParseResult(text: string) {
  const object = decodeAiJson(z.record(z.string(), z.unknown()), text);
  // Canonical shape remains supported for recorded fixtures and older text-only responses.
  if ("filters" in object) return parseResultSchema.parse(object);
  const { clarificationQuestion, ...flat } = flatSchema.parse(object);
  if (clarificationQuestion !== null) return parseResultSchema.parse({ filters: null, clarificationQuestion });
  const filters = Object.fromEntries(Object.entries(flat).filter(([key, value]) => value !== null && (!(["locations", "propertyKinds"].includes(key)) || !Array.isArray(value) || value.length > 0)));
  return parseResultSchema.parse({ filters, clarificationQuestion: null });
}
export const providerParseInstructions = `Верни ПЛОСКИЙ JSON по переданной text.format schema, без поля filters.
operation: sale/rent; priceUnit: rub_total/rub_month/rub_year/rub_m2_month/rub_m2_year.
locations: ${LOCATION_IDS.join("/")} (несколько = ИЛИ). suburbs = Новосибирск и пригороды, akademgorodok = Академгородок (Советский район), berdsk = Бердск, ob = город Обь (также «у Оби»), koltsovo = Кольцово, novosibirsk-region = область целиком. city согласуй с локацией; несколько локаций — city=Новосибирск.
propertyKinds: flat/house/apartments/non_residential; квартира/двушка = flat, дом/коттедж = house, апартаменты = apartments (нежилое), любое нежилое = non_residential. Для этих типов purposes=[], для офиса/склада используй purposes и propertyKinds=[].
Метры/метров после размера склада или офиса — площадь м². «В месяц» означает rent/rub_month даже без слова аренда. Для двушки сохрани «2 комнаты» в requiredFeatures: точного фильтра комнат нет, нужна проверка карточки.
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
