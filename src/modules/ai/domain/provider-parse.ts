import { z } from "zod";
import { parseResultSchema } from "./contracts";
import { decodeAiJson } from "./decode-json";

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
    purposes: strings, districts: strings, requiredFeatures: strings, preferredFeatures: strings, sources: strings,
    clarificationQuestion: nullableText,
  },
  required: ["city", "operation", "priceUnit", "priceFrom", "priceTo", "areaFrom", "areaTo", "floorMode", "seller",
    "purposes", "districts", "requiredFeatures", "preferredFeatures", "sources", "clarificationQuestion"],
};
const flatSchema = z.object({
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
  const filters = Object.fromEntries(Object.entries(flat).filter(([, value]) => value !== null));
  return parseResultSchema.parse({ filters, clarificationQuestion: null });
}
export const providerParseInstructions = `Верни ПЛОСКИЙ JSON по переданной text.format schema, без поля filters.
operation: sale/rent; priceUnit: rub_total/rub_month/rub_year/rub_m2_month/rub_m2_year.
purposes: retail/psn_universal/office/production/warehouse/free_purpose.
floorMode: first_floor_only/exclude_basement_and_semi_basement/any; seller: all/confirmed_owner_only.
sources: cian/mirkvartir/onrealt/domclick/yandex/youla/avito (все, если не ограничены запросом).
Неизвестные скалярные границы = null, отсутствующие признаки = []. Цена — десятичная строка рублей.
Если критическое условие неясно, clarificationQuestion — вопрос на русском, operation=null; иначе clarificationQuestion=null.
Новосибирск по умолчанию. Последующая фраза меняет currentFilters, остальные условия сохраняются.
Назначения/районы — ИЛИ, группы — И. Результат требует подтверждения пользователем.`;
