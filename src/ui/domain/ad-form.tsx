"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction, useUnsavedChangesWarning } from "../hooks";
import { Field, FormErrorBanner, SubmitButton } from "../form";
import { DisclosureSection } from "../disclosure-section";
import { DateTimeInput, SelectInput, type Option } from "../client-kit";
import { PropertySelect, type PropertyPick } from "./deal-pickers";
import type { AdFormValue } from "./deal-form-values";

/**
 * Рекламное объявление объекта (ТЗ 37.12, 40.5): площадка (код справочника), ссылка, рабочий текст,
 * статус и контрольные даты. Автопубликации нет — объявление ведётся вручную.
 */

export type { AdFormValue };

const STATUSES = optionsOf("advertisementStatus");
const URL_RE = /^https?:\/\/[^\s]+$/i;

function toPayload(v: AdFormValue) {
  return {
    platformCode: v.platformCode,
    url: v.url.trim() || null,
    adText: v.adText || null,
    status: v.status,
    publishedAt: v.publishedAt || null,
    expiresAt: v.expiresAt || null,
    comment: v.comment || null,
  };
}

export function AdForm({
  mode,
  initial,
  platforms,
  timeZone,
  users = [],
  initialProperty = null,
  adId,
  updatedAt,
}: {
  mode: "create" | "edit";
  initial: AdFormValue;
  platforms: Option[];
  timeZone: string;
  users?: Option[];
  initialProperty?: PropertyPick | null;
  adId?: string;
  updatedAt?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<AdFormValue>(initial);
  const [property, setProperty] = useState<PropertyPick | null>(initialProperty);
  const [responsibleUserId, setResponsible] = useState("");
  const [markChecked, setMarkChecked] = useState(false);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial) || property?.id !== initialProperty?.id || responsibleUserId !== "" || markChecked;
  useUnsavedChangesWarning(dirty && !pending);
  const set = <K extends keyof AdFormValue>(k: K, val: AdFormValue[K]) => setV((s) => ({ ...s, [k]: val }));

  async function submit() {
    const fe: Record<string, string[]> = {};
    if (mode === "create" && !property) fe.propertyId = ["Выберите объект"];
    if (!v.platformCode) fe.platformCode = ["Выберите площадку"];
    if (v.url.trim() && !URL_RE.test(v.url.trim())) fe.url = ["Ссылка должна начинаться с http(s)://"];
    if (Object.keys(fe).length) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: fe });
      return;
    }
    const payload = toPayload(v);
    if (mode === "create") {
      const res = await run(() => apiCall<{ id: string }>("POST", "/api/v1/advertisements", { ...payload, propertyId: property!.id, responsibleUserId: responsibleUserId || undefined }));
      if (res) router.push(`/advertisements/${res.id}`);
      return;
    }
    const before = toPayload(initial) as Record<string, unknown>;
    const changed = Object.fromEntries(Object.entries(payload).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify(before[k])));
    if (!Object.keys(changed).length && !markChecked) {
      router.push(`/advertisements/${adId}`);
      return;
    }
    const res = await run(() => apiCall("PATCH", `/api/v1/advertisements/${adId}`, { ...changed, expectedUpdatedAt: updatedAt, markChecked: markChecked || undefined }));
    if (res) {
      router.push(`/advertisements/${adId}`);
      router.refresh();
    }
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
      {mode === "create" ? (
        <Field label="Объект" required error={fieldError("propertyId")}>
          <PropertySelect value={property} onChange={setProperty} invalid={Boolean(fieldError("propertyId"))} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Площадка" required error={fieldError("platformCode")}>
          <SelectInput value={v.platformCode} onChange={(x) => set("platformCode", x)} options={platforms} placeholder="—" invalid={Boolean(fieldError("platformCode"))} />
        </Field>
        <Field label="Ссылка на объявление" error={fieldError("url")} className="md:col-span-2">
          <input className={`input ${fieldError("url") ? "input-error" : ""}`} type="url" placeholder="https://…" value={v.url} onChange={(e) => set("url", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Статус" required error={fieldError("status")}>
          <SelectInput value={v.status} onChange={(x) => set("status", x)} options={STATUSES} />
        </Field>
        <Field label="Опубликовано" hint={mode === "create" ? "Пусто — для активного объявления текущее время" : undefined} error={fieldError("publishedAt")}>
          <DateTimeInput value={v.publishedAt} onChange={(x) => set("publishedAt", x)} timeZone={timeZone} />
        </Field>
        <Field label="Активно до" hint="Срок размещения на площадке" error={fieldError("expiresAt")}>
          <input type="date" className="input" value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
        </Field>
      </div>
      <Field label="Текст объявления" hint={`Рабочий текст или копия опубликованного · ${v.adText.length} симв.`} error={fieldError("adText")}>
        <textarea className="input min-h-28 font-[inherit]" value={v.adText} onChange={(e) => set("adText", e.target.value)} />
      </Field>
      <DisclosureSection title="Комментарий и назначение ответственного" defaultOpen={Boolean(initial.comment)} error={[fieldError("comment"), fieldError("responsibleUserId")].filter(Boolean).join("; ")}>
      <Field label="Комментарий" error={fieldError("comment")}>
        <input className="input" value={v.comment} onChange={(e) => set("comment", e.target.value)} />
      </Field>
      {mode === "create" && users.length ? (
        <Field label="Ответственный" hint="По умолчанию — ответственный за объект" className="max-w-sm">
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Ответственный объекта" />
        </Field>
      ) : null}
      </DisclosureSection>
      {mode === "edit" ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={markChecked} onChange={(e) => setMarkChecked(e.target.checked)} /> Отметить: объявление проверено и актуально
        </label>
      ) : null}
      <div className="flex gap-2">
        <SubmitButton pending={pending}>{mode === "create" ? "Добавить объявление" : "Сохранить"}</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
