"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction, useUnsavedChangesWarning } from "../hooks";
import { Field, FormErrorBanner, SubmitButton } from "../form";
import { DateTimeInput, SelectInput, type Option } from "../client-kit";

/** Изменение рабочей сделки (до закрытия): этап, ИП/ООО, цена, ключевые даты, ответственный. */

export interface DealEditValue {
  status: string;
  legalEntityId: string;
  dealPrice: string;
  preliminaryAgreementAt: string;
  mainAgreementAt: string;
  registrationAt: string;
  notes: string;
  responsibleUserId: string;
}

const STATUSES = optionsOf("dealStatus").filter((o) => !["completed", "cancelled"].includes(o.value));
const MONEY_RE = /^\d{1,14}([.,]\d{1,2})?$/;

export function DealEditForm({ dealId, updatedAt, initial, legalEntities, users, timeZone }: { dealId: string; updatedAt: string; initial: DealEditValue; legalEntities: Option[]; users: Option[]; timeZone: string }) {
  const router = useRouter();
  const [v, setV] = useState<DealEditValue>(initial);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useUnsavedChangesWarning(dirty && !pending);
  const set = <K extends keyof DealEditValue>(k: K, val: DealEditValue[K]) => setV((s) => ({ ...s, [k]: val }));

  async function submit() {
    if (v.dealPrice && !MONEY_RE.test(v.dealPrice.replace(/\s/g, ""))) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: { dealPrice: ["Сумма: неотрицательное число"] } });
      return;
    }
    const changed: Record<string, unknown> = {};
    for (const k of Object.keys(v) as (keyof DealEditValue)[]) {
      if (v[k] === initial[k]) continue;
      if (k === "dealPrice") changed[k] = v.dealPrice.replace(/\s/g, "").replace(",", ".") || null;
      else if (k === "notes") changed[k] = v.notes || null;
      else changed[k] = v[k] || null;
    }
    if (!Object.keys(changed).length) {
      router.push(`/deals/${dealId}`);
      return;
    }
    const res = await run(() => apiCall("PATCH", `/api/v1/deals/${dealId}`, { ...changed, expectedUpdatedAt: updatedAt }));
    if (res) {
      router.push(`/deals/${dealId}`);
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Этап / статус" required error={fieldError("status")}>
          <SelectInput value={v.status} onChange={(x) => set("status", x)} options={STATUSES} />
        </Field>
        <Field label="ИП/ООО" required error={fieldError("legalEntityId")}>
          <SelectInput value={v.legalEntityId} onChange={(x) => set("legalEntityId", x)} options={legalEntities} />
        </Field>
        <Field label="Цена сделки, ₽" error={fieldError("dealPrice")}>
          <input className={`input ${fieldError("dealPrice") ? "input-error" : ""}`} inputMode="decimal" value={v.dealPrice} onChange={(e) => set("dealPrice", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Предварительный договор" error={fieldError("preliminaryAgreementAt")}>
          <DateTimeInput value={v.preliminaryAgreementAt} onChange={(x) => set("preliminaryAgreementAt", x)} timeZone={timeZone} />
        </Field>
        <Field label="Основной договор" error={fieldError("mainAgreementAt")}>
          <DateTimeInput value={v.mainAgreementAt} onChange={(x) => set("mainAgreementAt", x)} timeZone={timeZone} />
        </Field>
        <Field label="Регистрация" error={fieldError("registrationAt")}>
          <DateTimeInput value={v.registrationAt} onChange={(x) => set("registrationAt", x)} timeZone={timeZone} />
        </Field>
      </div>
      {users.length ? (
        <Field label="Ответственный" error={fieldError("responsibleUserId")} className="max-w-sm">
          <SelectInput value={v.responsibleUserId} onChange={(x) => set("responsibleUserId", x)} options={users} />
        </Field>
      ) : null}
      <Field label="Примечания" error={fieldError("notes")}>
        <textarea className="input min-h-24" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Сохранить</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
