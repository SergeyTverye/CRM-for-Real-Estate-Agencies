"use client";

import { Field } from "../form";
import { SelectInput, type Option } from "../client-kit";
import { optionsOf } from "@/shared/codebook";

/**
 * Параметры потребности (ТЗ 6.2, 37.6): компактные смысловые группы — запрос, бюджет,
 * район/локация, площадь, финансирование (статус ипотеки — только для ипотеки/смешанного),
 * дополнительные требования по типу недвижимости. Используется в обращении, создании и редактировании.
 */

export interface NeedParamsValue {
  operationType: string;
  propertyType: string;
  propertySubtype: string;
  financingType: string;
  mortgageStatus: string;
  budgetMin: string;
  budgetMax: string;
  district: string;
  locationText: string;
  areaMin: string;
  areaMax: string;
  commercialPurpose: string;
  floorMin: string;
  floorMax: string;
  roomsMin: string;
  roomsMax: string;
  landAreaMin: string;
  landAreaMax: string;
  buildingAreaMin: string;
  buildingAreaMax: string;
  powerRequirement: string;
  /** "" — не важно, "true"/"false" — требование. */
  parkingRequirement: string;
  tenantRequirement: string;
  notes: string;
}

export interface NeedParamsOptions {
  operationTypes: Option[];
  propertyTypes: Option[];
  propertySubtypes: Option[];
  commercialPurposes: Option[];
}

export const emptyNeedParams = (): NeedParamsValue => ({
  operationType: "",
  propertyType: "",
  propertySubtype: "",
  financingType: "",
  mortgageStatus: "",
  budgetMin: "",
  budgetMax: "",
  district: "",
  locationText: "",
  areaMin: "",
  areaMax: "",
  commercialPurpose: "",
  floorMin: "",
  floorMax: "",
  roomsMin: "",
  roomsMax: "",
  landAreaMin: "",
  landAreaMax: "",
  buildingAreaMin: "",
  buildingAreaMax: "",
  powerRequirement: "",
  parkingRequirement: "",
  tenantRequirement: "",
  notes: "",
});

type ExtraGroup = "rooms" | "floor" | "commercial" | "land" | "building";

const GROUPS_BY_TYPE: Record<string, ExtraGroup[]> = {
  residential: ["rooms", "floor"],
  commercial: ["commercial", "floor"],
  country: ["rooms", "land", "building"],
  land: ["land"],
};

/** Группы дополнительных требований для типа недвижимости (для нового типа из справочника — все). */
export function needExtraGroups(propertyType: string): ExtraGroup[] {
  if (!propertyType) return [];
  return GROUPS_BY_TYPE[propertyType] ?? ["rooms", "floor", "commercial", "land", "building"];
}

const SUBTYPES_BY_TYPE: Record<string, string[]> = {
  residential: ["apartment", "room", "house", "townhouse", "other"],
  commercial: ["office", "retail", "free_purpose", "warehouse", "production", "building", "other"],
  country: ["house", "townhouse", "land_plot", "other"],
  land: ["land_plot", "other"],
};
const KNOWN_SUBTYPES = new Set(Object.values(SUBTYPES_BY_TYPE).flat());

export const isMortgageFinancing = (financingType: string) => financingType === "mortgage" || financingType === "mixed";

/** Тело запроса для API: пустые строки → null, неприменимые к типу поля очищаются. */
export function needParamsPayload(v: NeedParamsValue) {
  const g = new Set(needExtraGroups(v.propertyType));
  const s = (x: string) => (x.trim() === "" ? null : x.trim());
  const b = (x: string) => (x === "true" ? true : x === "false" ? false : null);
  const commercial = g.has("commercial");
  return {
    operationType: v.operationType,
    propertyType: v.propertyType,
    propertySubtype: s(v.propertySubtype),
    financingType: s(v.financingType),
    mortgageStatus: isMortgageFinancing(v.financingType) ? s(v.mortgageStatus) : null,
    budgetMin: s(v.budgetMin),
    budgetMax: s(v.budgetMax),
    district: s(v.district),
    locationText: s(v.locationText),
    areaMin: s(v.areaMin),
    areaMax: s(v.areaMax),
    commercialPurpose: commercial ? s(v.commercialPurpose) : null,
    floorMin: g.has("floor") ? s(v.floorMin) : null,
    floorMax: g.has("floor") ? s(v.floorMax) : null,
    roomsMin: g.has("rooms") ? s(v.roomsMin) : null,
    roomsMax: g.has("rooms") ? s(v.roomsMax) : null,
    landAreaMin: g.has("land") ? s(v.landAreaMin) : null,
    landAreaMax: g.has("land") ? s(v.landAreaMax) : null,
    buildingAreaMin: g.has("building") ? s(v.buildingAreaMin) : null,
    buildingAreaMax: g.has("building") ? s(v.buildingAreaMax) : null,
    powerRequirement: commercial ? s(v.powerRequirement) : null,
    parkingRequirement: commercial ? b(v.parkingRequirement) : null,
    tenantRequirement: commercial ? b(v.tenantRequirement) : null,
    notes: s(v.notes),
  };
}

const BUDGET_LABEL: Record<string, string> = {
  buy: "Бюджет покупки, ₽",
  rent: "Арендная ставка, ₽/мес",
  sell: "Ожидаемая цена продажи, ₽",
  lease_out: "Ожидаемая ставка аренды, ₽/мес",
};

const FINANCING = optionsOf("financingType");
const MORTGAGE = optionsOf("mortgageStatus");
const PARKING: Option[] = [
  { value: "true", label: "Нужна парковка" },
  { value: "false", label: "Без парковки" },
];
const TENANT: Option[] = [
  { value: "true", label: "С действующим арендатором" },
  { value: "false", label: "Свободное, без арендатора" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, invalid, placeholder, decimal = true }: { value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; decimal?: boolean }) {
  return (
    <input
      className={`input ${invalid ? "input-error" : ""}`}
      inputMode={decimal ? "decimal" : "numeric"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NeedParamsFields({
  value,
  onChange,
  options,
  fieldError,
  prefix = "",
  compact = false,
}: {
  value: NeedParamsValue;
  onChange: (v: NeedParamsValue) => void;
  options: NeedParamsOptions;
  fieldError: (name: string) => string | undefined;
  /** Префикс путей ошибок сервера, например "outcome.need." в форме обращения. */
  prefix?: string;
  /** Быстрая форма (обращение): только основные параметры. */
  compact?: boolean;
}) {
  const err = (n: string) => fieldError(`${prefix}${n}`);
  const set = <K extends keyof NeedParamsValue>(k: K, v: NeedParamsValue[K]) => onChange({ ...value, [k]: v });
  const groups = new Set(needExtraGroups(value.propertyType));
  const allowed = SUBTYPES_BY_TYPE[value.propertyType];
  const subtypes = options.propertySubtypes.filter((o) => !allowed || allowed.includes(o.value) || !KNOWN_SUBTYPES.has(o.value) || o.value === value.propertySubtype);
  const mortgage = isMortgageFinancing(value.financingType);
  const budgetLabel = BUDGET_LABEL[value.operationType] ?? "Бюджет, ₽";

  const num = (k: keyof NeedParamsValue, label: string, opts: { decimal?: boolean; placeholder?: string } = {}) => (
    <Field label={label} error={err(k)}>
      <NumInput value={value[k]} onChange={(v) => set(k, v)} invalid={Boolean(err(k))} decimal={opts.decimal} placeholder={opts.placeholder} />
    </Field>
  );

  return (
    <div className="space-y-4">
      <Section title="Запрос">
        <Field label="Операция" required error={err("operationType")}>
          <SelectInput value={value.operationType} onChange={(v) => set("operationType", v)} options={options.operationTypes} placeholder="—" invalid={Boolean(err("operationType"))} />
        </Field>
        <Field label="Тип недвижимости" required error={err("propertyType")}>
          <SelectInput value={value.propertyType} onChange={(v) => set("propertyType", v)} options={options.propertyTypes} placeholder="—" invalid={Boolean(err("propertyType"))} />
        </Field>
        <Field label="Подтип" error={err("propertySubtype")}>
          <SelectInput value={value.propertySubtype} onChange={(v) => set("propertySubtype", v)} options={subtypes} placeholder="Любой" />
        </Field>
        {compact ? (
          <Field label="Район" error={err("district")}>
            <input className="input" value={value.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
        ) : null}
      </Section>

      <Section title={compact ? "Бюджет и площадь" : "Бюджет"}>
        {num("budgetMin", `${budgetLabel}, от`)}
        {num("budgetMax", "до")}
        {compact ? (
          <>
            {num("areaMin", "Площадь, м², от")}
            {num("areaMax", "до")}
          </>
        ) : null}
      </Section>

      {!compact ? (
        <>
          <Section title="Район / локация">
            <Field label="Район" error={err("district")}>
              <input className="input" value={value.district} onChange={(e) => set("district", e.target.value)} />
            </Field>
            <Field label="Локация, ориентиры" error={err("locationText")} className="col-span-2 md:col-span-3">
              <input className="input" value={value.locationText} placeholder="Улица, микрорайон, рядом с…" onChange={(e) => set("locationText", e.target.value)} />
            </Field>
          </Section>
          <Section title="Площадь">
            {num("areaMin", "Площадь, м², от")}
            {num("areaMax", "до")}
          </Section>
        </>
      ) : null}

      <Section title="Финансирование">
        <Field label="Способ оплаты" error={err("financingType")}>
          <SelectInput value={value.financingType} onChange={(v) => set("financingType", v)} options={FINANCING} placeholder="Не указан" />
        </Field>
        {mortgage ? (
          <Field label="Статус ипотеки" error={err("mortgageStatus")}>
            <SelectInput value={value.mortgageStatus} onChange={(v) => set("mortgageStatus", v)} options={MORTGAGE} placeholder="Не указан" />
          </Field>
        ) : null}
      </Section>

      {!compact && groups.size ? (
        <Section title="Дополнительные требования">
          {groups.has("rooms") ? (
            <>
              {num("roomsMin", "Комнат, от", { decimal: false })}
              {num("roomsMax", "до", { decimal: false })}
            </>
          ) : null}
          {groups.has("floor") ? (
            <>
              {num("floorMin", "Этаж, от", { decimal: false })}
              {num("floorMax", "до", { decimal: false })}
            </>
          ) : null}
          {groups.has("commercial") ? (
            <>
              <Field label="Назначение помещения" error={err("commercialPurpose")}>
                <SelectInput value={value.commercialPurpose} onChange={(v) => set("commercialPurpose", v)} options={options.commercialPurposes} placeholder="Не указано" />
              </Field>
              {num("powerRequirement", "Электрическая мощность, кВт, от")}
              <Field label="Парковка" error={err("parkingRequirement")}>
                <SelectInput value={value.parkingRequirement} onChange={(v) => set("parkingRequirement", v)} options={PARKING} placeholder="Не важно" />
              </Field>
              <Field label="Арендатор" error={err("tenantRequirement")}>
                <SelectInput value={value.tenantRequirement} onChange={(v) => set("tenantRequirement", v)} options={TENANT} placeholder="Не важно" />
              </Field>
            </>
          ) : null}
          {groups.has("land") ? (
            <>
              {num("landAreaMin", "Участок, сот., от")}
              {num("landAreaMax", "до")}
            </>
          ) : null}
          {groups.has("building") ? (
            <>
              {num("buildingAreaMin", "Площадь дома/здания, м², от")}
              {num("buildingAreaMax", "до")}
            </>
          ) : null}
        </Section>
      ) : null}

      {!compact ? (
        <Field label="Комментарий к запросу" error={err("notes")}>
          <textarea className="input min-h-16" value={value.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      ) : null}
    </div>
  );
}
