import "server-only";
import type { Actor } from "@/modules/auth/domain/actor";
import { distinctDistricts } from "@/modules/properties/application/property-queries";
import { codeOptions, dictOptions, loadDictionaries, userOptions } from "@/server/options";
import type { PropertyFormOptions, PropertyFormValue } from "./property-form";

/** Опции формы объекта. Деактивированное текущее значение справочника сохраняется в списке. */
export async function propertyFormOptions(actor: Actor, opts: { create: boolean; current?: Partial<PropertyFormValue> }): Promise<PropertyFormOptions> {
  const dicts = await loadDictionaries();
  const c = opts.current ?? {};
  const statuses = codeOptions("propertyStatus").filter((s) => {
    if (opts.create) return ["draft", "active"].includes(s.value);
    // Решение об архивировании принимает руководитель (ТЗ 3.1, 27.1).
    if (s.value === "archived") return actor.role === "manager" || c.status === "archived";
    return true;
  });
  return {
    operations: dictOptions(dicts, "property_operation_type", c.operationType),
    types: dictOptions(dicts, "property_type", c.propertyType),
    subtypes: dictOptions(dicts, "property_subtype", c.propertySubtype),
    sources: codeOptions("propertySourceType"),
    platforms: dictOptions(dicts, "ad_platform", c.sourcePlatformCode),
    purposes: dictOptions(dicts, "commercial_purpose", c.commercialPurpose),
    statuses,
    districts: await distinctDistricts(),
    users: opts.create && actor.role === "manager" ? await userOptions() : [],
  };
}
