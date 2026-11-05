import { z } from "zod";

export const numericCondition = z.object({ min: z.number().finite().nonnegative().optional(), max: z.number().finite().nonnegative().optional() }).strict()
  .refine(v => v.min !== undefined || v.max !== undefined, "Укажите порог или диапазон")
  .refine(v => v.min === undefined || v.max === undefined || v.min <= v.max, "Неверный диапазон");
/** One registry drives validation and the generic form. New features need no form changes. */
export const FEATURE_DEFINITIONS = {
  separate_entrance: { label: "Отдельный вход", kind: "boolean", purposes: ["office", "retail", "psn_universal", "production", "warehouse", "free_purpose"] },
  shop_window: { label: "Витрина", kind: "boolean", purposes: ["retail", "psn_universal", "free_purpose"] },
  first_line: { label: "Первая линия", kind: "boolean", purposes: ["office", "retail", "psn_universal", "free_purpose"] },
  wet_point: { label: "Мокрая точка", kind: "boolean" },
  power_kw: { label: "Мощность кВт", kind: "range", unit: "кВт" },
  ceiling_m: { label: "Высота потолков", kind: "range", unit: "м" },
  gates: { label: "Ворота", kind: "boolean", purposes: ["production", "warehouse", "free_purpose"] },
  unloading: { label: "Разгрузка", kind: "boolean", purposes: ["retail", "production", "warehouse", "free_purpose"] },
  parking: { label: "Парковка", kind: "boolean" },
  tenant: { label: "Арендатор", kind: "boolean" },
  vacant: { label: "Свободно", kind: "boolean" },
} as const;
export type FeatureKey = keyof typeof FEATURE_DEFINITIONS;
export const featureKeys = Object.keys(FEATURE_DEFINITIONS) as [FeatureKey, ...FeatureKey[]];
export const featureConditions = z.partialRecord(z.enum(featureKeys), z.union([z.boolean(), numericCondition])).superRefine((values, ctx) => {
  for (const [key, value] of Object.entries(values)) {
    if ((FEATURE_DEFINITIONS[key as FeatureKey].kind === "range") !== (typeof value === "object")) ctx.addIssue({ code: "custom", path: [key], message: "Числовой признак требует порога или диапазона; остальные — да/нет" });
  }
});
type CoreKey = "city" | "districts" | "operation" | "purposes" | "price" | "priceUnit" | "area" | "floor" | "floorMode" | "seller" | "hasPhotos" | "freshness" | "sources" | "verification";
export interface FilterDefinition { key: CoreKey | `features.${FeatureKey}`; label: string; kind: "text" | "multi" | "select" | "range" | "boolean" | "freshness"; unit?: string; options?: readonly string[]; purposes?: readonly string[]; fromField?: string; toField?: string }
export const FILTER_CATALOG: readonly FilterDefinition[] = [
  { key: "city", label: "Город", kind: "text" }, { key: "districts", label: "Районы", kind: "multi" },
  { key: "operation", label: "Операция", kind: "select", options: ["sale", "rent"] },
  { key: "purposes", label: "Назначения (ИЛИ)", kind: "multi", options: ["office", "retail", "psn_universal", "production", "warehouse", "free_purpose"] },
  { key: "price", label: "Бюджет / цена", kind: "range", unit: "RUB", fromField: "priceFrom", toField: "priceTo" },
  { key: "priceUnit", label: "Единица цены", kind: "select", options: ["rub_total", "rub_month", "rub_year", "rub_m2_month", "rub_m2_year"] },
  { key: "area", label: "Площадь", kind: "range", unit: "м²", fromField: "areaFrom", toField: "areaTo" }, { key: "floor", label: "Этаж", kind: "range", fromField: "floorFrom", toField: "floorTo" },
  { key: "floorMode", label: "Первый этаж / без подвала и цоколя", kind: "select", options: ["any", "first_floor_only", "exclude_basement_and_semi_basement"] },
  { key: "seller", label: "Продавец", kind: "select", options: ["all", "confirmed_owner_only", "agent"] },
  { key: "hasPhotos", label: "Есть фотографии", kind: "boolean" }, { key: "freshness", label: "Свежесть", kind: "freshness" },
  { key: "sources", label: "Источники", kind: "multi", options: ["cian", "avito", "domclick", "yandex", "mirkvartir", "onrealt", "youla"] },
  { key: "verification", label: "Проверка", kind: "select", options: ["all", "checked", "unchecked"] },
  ...featureKeys.map((key): FilterDefinition => ({ key: `features.${key}`, ...FEATURE_DEFINITIONS[key] })),
];
