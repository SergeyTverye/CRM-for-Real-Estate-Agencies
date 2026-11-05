"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MediaUploadQueue, useMediaQueue } from "./media-upload";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { SelectInput, type Option } from "@/ui/client-kit";

export interface PropertyFormValue {
  operationType: string;
  propertyType: string;
  propertySubtype: string;
  sourceType: string;
  sourcePlatformCode: string;
  sourceUrl: string;
  addressText: string;
  district: string;
  area: string;
  price: string;
  floor: string;
  floorsTotal: string;
  roomsCount: string;
  landArea: string;
  buildingArea: string;
  commercialPurpose: string;
  powerKw: string;
  parkingAvailable: string;
  hasTenant: string;
  status: string;
  description: string;
  responsibleUserId: string;
}

const emptyProperty = (): PropertyFormValue => ({
  operationType: "",
  propertyType: "",
  propertySubtype: "",
  sourceType: "agency_listing",
  sourcePlatformCode: "",
  sourceUrl: "",
  addressText: "",
  district: "",
  area: "",
  price: "",
  floor: "",
  floorsTotal: "",
  roomsCount: "",
  landArea: "",
  buildingArea: "",
  commercialPurpose: "",
  powerKw: "",
  parkingAvailable: "",
  hasTenant: "",
  status: "active",
  description: "",
  responsibleUserId: "",
});

export interface PropertyFormOptions {
  operations: Option[];
  types: Option[];
  subtypes: Option[];
  sources: Option[];
  platforms: Option[];
  purposes: Option[];
  statuses: Option[];
  districts: string[];
  /** Только для руководителя при создании. */
  users: Option[];
}

// Тот же шаблон, что и на сервере: телефон собственника не должен попадать в общее описание (ТЗ 37.7).
const PHONE_IN_TEXT_RE = /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;
const KNOWN_TYPES = ["residential", "commercial", "country", "land"];

const TRI_STATE: Option[] = [
  { value: "true", label: "Да" },
  { value: "false", label: "Нет" },
];

function pricePerSqm(price: string, area: string): string | null {
  const p = Number(price.replace(/\s/g, "").replace(",", "."));
  const a = Number(area.replace(/\s/g, "").replace(",", "."));
  if (!p || !a || !Number.isFinite(p / a)) return null;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(p / a)} ₽/м²`;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-600">{title}</legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">{children}</div>
    </fieldset>
  );
}

export function PropertyForm({
  mode,
  id,
  updatedAt,
  initial: initialProp,
  options,
}: {
  mode: "create" | "edit";
  id?: string;
  updatedAt?: string;
  /** Для создания не передаётся — форма начинается с пустых значений. */
  initial?: PropertyFormValue;
  options: PropertyFormOptions;
}) {
  const router = useRouter();
  const queue = useMediaQueue();
  const [savedId, setSavedId] = useState<string>();
  const submitting = useRef(false);
  const [initial] = useState(() => initialProp ?? emptyProperty());
  const [v, setV] = useState(initial);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useUnsavedChangesWarning(dirty && !savedId && !pending && !queue.busy);
  const set = <K extends keyof PropertyFormValue>(k: K, value: PropertyFormValue[K]) => setV((s) => ({ ...s, [k]: value }));

  const unknownType = v.propertyType !== "" && !KNOWN_TYPES.includes(v.propertyType);
  const residential = v.propertyType === "residential" || unknownType;
  const commercial = v.propertyType === "commercial" || unknownType;
  const landOrCountry = v.propertyType === "country" || v.propertyType === "land" || unknownType;
  const external = v.sourceType === "external_market";
  const phoneInDescription = PHONE_IN_TEXT_RE.test(v.description);
  const perSqm = pricePerSqm(v.price, v.area);

  const input = (k: keyof PropertyFormValue, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={`input ${fieldError(k) ? "input-error" : ""}`} value={v[k]} onChange={(e) => set(k, e.target.value)} {...props} />
  );

  async function submit() {
    if (submitting.current || queue.busy) return;
    if (savedId) {
      submitting.current = true;
      try { if (await queue.upload(savedId)) { router.push(`/properties/${savedId}`); router.refresh(); } }
      finally { submitting.current = false; }
      return;
    }
    if (phoneInDescription) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте правильность заполнения полей", fieldErrors: { description: ["Уберите телефон из описания — контакты собственника ведутся во вкладке «Собственники»"] } });
      return;
    }
    if (mode === "edit" && v.status === "archived" && initial.status !== "archived" && !window.confirm("Перевести объект в архив? Он исчезнет из рабочего каталога и подбора, история сохранится.")) return;
    const n = (s: string) => (s.trim() === "" ? null : s.trim());
    const body: Record<string, unknown> = {
      operationType: v.operationType,
      propertyType: v.propertyType,
      propertySubtype: n(v.propertySubtype),
      sourceType: v.sourceType,
      sourcePlatformCode: external ? n(v.sourcePlatformCode) : null,
      sourceUrl: external ? n(v.sourceUrl) : null,
      addressText: v.addressText,
      district: n(v.district),
      area: n(v.area),
      price: n(v.price),
      floor: n(v.floor),
      floorsTotal: n(v.floorsTotal),
      roomsCount: n(v.roomsCount),
      landArea: n(v.landArea),
      buildingArea: n(v.buildingArea),
      commercialPurpose: n(v.commercialPurpose),
      powerKw: n(v.powerKw),
      parkingAvailable: v.parkingAvailable === "" ? null : v.parkingAvailable === "true",
      hasTenant: v.hasTenant === "" ? null : v.hasTenant === "true",
      status: v.status,
      description: n(v.description),
    };
    submitting.current = true;
    try {
      if (mode === "create" && v.responsibleUserId) body.responsibleUserId = v.responsibleUserId;
      const res = await run(() => mode === "create"
        ? apiCall<{ id: string }>("POST", "/api/v1/properties", body)
        : apiCall<{ id: string }>("PATCH", `/api/v1/properties/${id}`, { ...body, expectedUpdatedAt: updatedAt }));
      if (res) {
        setSavedId(res.id);
        if (await queue.upload(res.id)) { router.push(`/properties/${res.id}`); router.refresh(); }
      }
    } finally { submitting.current = false; }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormErrorBanner error={error} />

      {savedId ? <p role="status">Объект сохранён. Повторите загрузку неудачных файлов или <Link className="link" href={`/properties/${savedId}`}>откройте карточку</Link>.</p> : null}
      <fieldset disabled={pending || queue.busy || Boolean(savedId)} className="space-y-4">
      <Group title="Операция и тип">
        <Field label="Операция" required error={fieldError("operationType")}>
          <SelectInput value={v.operationType} onChange={(x) => set("operationType", x)} options={options.operations} placeholder="Выберите…" invalid={Boolean(fieldError("operationType"))} />
        </Field>
        <Field label="Тип недвижимости" required error={fieldError("propertyType")}>
          <SelectInput value={v.propertyType} onChange={(x) => set("propertyType", x)} options={options.types} placeholder="Выберите…" invalid={Boolean(fieldError("propertyType"))} />
        </Field>
        <Field label="Подтип" error={fieldError("propertySubtype")}>
          <SelectInput value={v.propertySubtype} onChange={(x) => set("propertySubtype", x)} options={options.subtypes} placeholder="—" />
        </Field>
        <Field label="Статус" error={fieldError("status")}>
          <SelectInput value={v.status} onChange={(x) => set("status", x)} options={options.statuses} />
        </Field>
      </Group>

      <Group title="Происхождение">
        <Field label="Источник объекта" required error={fieldError("sourceType")} hint={external ? "Объект внешнего рынка — для подбора, может требовать прозвона" : "Объект ведёт/рекламирует агентство; реклама — через «Объявления»"}>
          <SelectInput value={v.sourceType} onChange={(x) => set("sourceType", x)} options={options.sources} />
        </Field>
        {external ? (
          <>
            <Field label="Площадка-источник" error={fieldError("sourcePlatformCode")}>
              <SelectInput value={v.sourcePlatformCode} onChange={(x) => set("sourcePlatformCode", x)} options={options.platforms} placeholder="—" />
            </Field>
            <Field label="Ссылка на объявление" error={fieldError("sourceUrl")} className="md:col-span-2">
              {input("sourceUrl", { placeholder: "https://…", inputMode: "url" })}
            </Field>
          </>
        ) : null}
        {mode === "create" && options.users.length ? (
          <Field label="Ответственный" hint="По умолчанию — вы" className={external ? "md:col-span-4" : "md:col-span-2"}>
            <SelectInput value={v.responsibleUserId} onChange={(x) => set("responsibleUserId", x)} options={options.users} placeholder="Я" />
          </Field>
        ) : null}
      </Group>

      <Group title="Адрес">
        <Field label="Адрес" required error={fieldError("addressText")} className="md:col-span-3">
          {input("addressText", { placeholder: "Город, улица, дом, помещение" })}
        </Field>
        <Field label="Район" error={fieldError("district")}>
          {input("district", { list: "property-districts" })}
          <datalist id="property-districts">
            {options.districts.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
      </Group>

      <Group title="Площадь и цена">
        <Field label="Площадь, м²" error={fieldError("area")}>
          {input("area", { inputMode: "decimal" })}
        </Field>
        <Field label={v.operationType === "rent" ? "Цена, ₽/мес" : "Цена, ₽"} error={fieldError("price")} hint={perSqm ?? undefined}>
          {input("price", { inputMode: "decimal" })}
        </Field>
        {residential || commercial ? (
          <>
            <Field label="Этаж" error={fieldError("floor")}>
              {input("floor", { inputMode: "numeric" })}
            </Field>
            <Field label="Этажей в здании" error={fieldError("floorsTotal")}>
              {input("floorsTotal", { inputMode: "numeric" })}
            </Field>
          </>
        ) : null}
        {residential ? (
          <Field label="Комнат" error={fieldError("roomsCount")}>
            {input("roomsCount", { inputMode: "numeric" })}
          </Field>
        ) : null}
        {landOrCountry ? (
          <>
            <Field label="Площадь участка, сот." error={fieldError("landArea")}>
              {input("landArea", { inputMode: "decimal" })}
            </Field>
            <Field label="Площадь строения, м²" error={fieldError("buildingArea")}>
              {input("buildingArea", { inputMode: "decimal" })}
            </Field>
          </>
        ) : null}
      </Group>

      {commercial ? (
        <Group title="Коммерческая недвижимость">
          <Field label="Назначение" error={fieldError("commercialPurpose")}>
            <SelectInput value={v.commercialPurpose} onChange={(x) => set("commercialPurpose", x)} options={options.purposes} placeholder="—" />
          </Field>
          <Field label="Электрическая мощность, кВт" error={fieldError("powerKw")}>
            {input("powerKw", { inputMode: "decimal" })}
          </Field>
          <Field label="Парковка" error={fieldError("parkingAvailable")}>
            <SelectInput value={v.parkingAvailable} onChange={(x) => set("parkingAvailable", x)} options={TRI_STATE} placeholder="Не указано" />
          </Field>
          <Field label="Есть арендатор" error={fieldError("hasTenant")}>
            <SelectInput value={v.hasTenant} onChange={(x) => set("hasTenant", x)} options={TRI_STATE} placeholder="Не указано" />
          </Field>
        </Group>
      ) : null}

      <Field
        label="Описание"
        error={fieldError("description") ?? (phoneInDescription ? "Похоже на телефон — уберите его: контакты собственника ведутся во вкладке «Собственники»" : undefined)}
        hint="Не указывайте телефоны и контакты собственника — система не сохранит описание с номером телефона"
      >
        <textarea className={`input min-h-28 ${phoneInDescription ? "input-error" : ""}`} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      </fieldset>
      <MediaUploadQueue queue={queue} propertyId={savedId ?? id} disabled={pending} />
      <div className="flex gap-2">
        <SubmitButton pending={pending || queue.busy}>{savedId ? "Повторить загрузку и открыть карточку" : mode === "create" ? "Создать объект" : "Сохранить"}</SubmitButton>
        <button type="button" className="btn" disabled={pending || queue.busy} onClick={() => { if ((!dirty && !queue.hasPending) || window.confirm("Покинуть форму? Несохранённые изменения и очередь файлов будут потеряны.")) router.back(); }}>
          Отмена
        </button>
      </div>
    </form>
  );
}
