"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction, useUnsavedChangesWarning } from "../hooks";
import { Field, FormErrorBanner, SubmitButton } from "../form";
import { SelectInput, type Option } from "../client-kit";
import { ClientPicker, type ClientPick } from "./need-pickers";
import { PropertySelect, type PropertyPick } from "./deal-pickers";
import type { AgreementFormValue } from "./deal-form-values";
import { FilePicker } from "../file-picker";
import { requestConfirmation } from "../confirm-dialog";
import { uploadAgreementDocuments, type PendingAgreementDocument } from "./agreement-document-uploads";



export type { AgreementFormValue };

export interface AgreementFormOptions {
  legalEntities: Option[];
  absenceReasons: Option[];
  commissionTypes: Option[];
  users: Option[];
}

const TYPES = optionsOf("agreementType");
const ABSENT = ["no_agreement", "declined"];
const REMINDERS: Option[] = [
  { value: "7", label: "за 7 дней" },
  { value: "14", label: "за 14 дней" },
  { value: "30", label: "за 30 дней" },
  { value: "60", label: "за 60 дней" },
];

function toPayload(v: AgreementFormValue) {
  return {
    agreementType: v.agreementType,
    status: v.status,
    agreementNumber: v.agreementNumber || null,
    isExclusive: v.isExclusive === "" ? null : v.isExclusive === "true",
    signedAt: v.signedAt || null,
    validFrom: v.validFrom || null,
    validUntil: v.validUntil || null,
    legalEntityId: v.legalEntityId || null,
    commissionType: v.commissionType || null,
    commissionValue: v.commissionValue || null,
    commissionNotes: v.commissionNotes || null,
    absenceReasonCode: v.absenceReasonCode || null,
    actionRequired: v.actionRequired || null,
    notes: v.notes || null,
  };
}


function localErrors(v: AgreementFormValue): Record<string, string[]> {
  const e: Record<string, string[]> = {};
  if (v.status === "signed" && !v.signedAt) e.signedAt = ["Для подписанного договора укажите дату подписания"];
  if (v.status === "signed" && v.onBehalfOfCompany && !v.legalEntityId) e.legalEntityId = ["Выберите ИП/ООО, от имени которого подписан договор"];
  if (v.validFrom && v.validUntil && v.validFrom > v.validUntil) e.validUntil = ["Окончание раньше начала"];
  if (v.commissionValue && !/^\d{1,14}([.,]\d{1,2})?$/.test(v.commissionValue.replace(/\s/g, ""))) e.commissionValue = ["Сумма: неотрицательное число"];
  return e;
}

export function AgreementForm({
  mode,
  options,
  initial,
  agreementId,
  updatedAt,
  initialClient = null,
  initialProperty = null,
  deal = null,
  returnHref,
  uploadPolicy,
}: {
  mode: "create" | "edit";
  options: AgreementFormOptions;
  initial: AgreementFormValue;
  agreementId?: string;
  updatedAt?: string;
  initialClient?: ClientPick | null;
  initialProperty?: PropertyPick | null;
  deal?: { id: string; label: string } | null;
  returnHref?: string;
  uploadPolicy?: { accept: string; maxMb: number };
}) {
  const router = useRouter();
  const [v, setV] = useState<AgreementFormValue>(initial);
  const [client, setClient] = useState<ClientPick | null>(initialClient);
  const [property, setProperty] = useState<PropertyPick | null>(initialProperty);
  const [responsibleUserId, setResponsible] = useState("");
  const [reminder, setReminder] = useState("30");
  const [files, setFiles] = useState<PendingAgreementDocument[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [finished, setFinished] = useState(false);
  const submitting = useRef(false);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial) || client?.id !== initialClient?.id || property?.id !== initialProperty?.id || responsibleUserId !== "" || reminder !== "30";
  useUnsavedChangesWarning(!finished && (savedId ? files.length > 0 : dirty || files.length > 0));
  const set = <K extends keyof AgreementFormValue>(k: K, val: AgreementFormValue[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (n: string) => fieldError(n);
  const legalRequired = v.status === "signed" && v.onBehalfOfCompany;
  const statusOptions = optionsOf("agreementStatus").filter((o) => o.value !== "archived" || initial.status === "archived");

  async function submit() {
    if (submitting.current || finished) return;
    if (savedId) {
      await uploadFiles(savedId);
      return;
    }
    const local = localErrors(v);
    if (uploadPolicy && files.some(({ file }) => file.size === 0 || file.size > uploadPolicy.maxMb * 1024 * 1024 || !uploadPolicy.accept.split(",").includes(`.${file.name.split(".").pop()?.toLowerCase()}`))) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте формат и размер выбранных файлов" });
      return;
    }
    if (mode === "create" && !client && !property && !deal) local.clientId = ["Свяжите договор с клиентом, объектом или сделкой"];
    if (Object.keys(local).length) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: local });
      return;
    }
    const payload = toPayload(v);
    if (mode === "create") {
      submitting.current = true;
      const res = await run(() =>
        apiCall<{ id: string }>("POST", "/api/v1/agreements", {
          ...payload,
          onBehalfOfCompany: v.onBehalfOfCompany,
          clientId: client?.id,
          propertyId: property?.id,
          dealId: deal?.id,
          responsibleUserId: responsibleUserId || undefined,
          reminderDaysBefore: v.validUntil && reminder ? Number(reminder) : undefined,
        }),
      );
      if (res) {
        setSavedId(res.id);
        await uploadFiles(res.id);
      } else submitting.current = false;
      return;
    }
    
    const before = toPayload(initial) as Record<string, unknown>;
    const changed = Object.fromEntries(Object.entries(payload).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify(before[k])));
    const res = await run(() => apiCall("PATCH", `/api/v1/agreements/${agreementId}`, { ...changed, expectedUpdatedAt: updatedAt, onBehalfOfCompany: v.onBehalfOfCompany }));
    if (res) {
      router.push(returnHref ?? `/agreements/${agreementId}`);
      router.refresh();
    }
  }

  async function uploadFiles(id: string) {
    submitting.current = true;
    setUploading(true);
    try {
      const failed = await uploadAgreementDocuments(id, files);
      setFiles(failed);
      if (!failed.length) {
        setFinished(true);
        router.push(`/agreements/${id}#documents`);
      }
    } finally {
      setUploading(false);
      submitting.current = false;
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormErrorBanner error={error} />

      {savedId && !finished ? (
        <div className="space-y-3" role="status">
          <p className={uploading ? "alert alert-info" : "alert alert-warning"}>{uploading ? "Договор сохранён. Загружаются документы…" : "Договор сохранён. Остались незагруженные файлы; повторная попытка загрузит только их."}</p>
          <ul className="space-y-2">{files.map((item, i) => <li key={i}>{item.file.name} — {item.error ?? "Загрузка…"}</li>)}</ul>
          <button type="button" className="btn btn-primary" disabled={uploading || finished} onClick={() => { if (!submitting.current) void uploadFiles(savedId); }}>{uploading ? "Загрузка файлов…" : "Повторить загрузку"}</button>
          <button type="button" className="btn" disabled={uploading} onClick={async () => { if (await requestConfirmation("Незагруженные файлы останутся только на вашем компьютере. Перейти в карточку?")) { setFinished(true); router.push(`/agreements/${savedId}#documents`); } }}>Открыть сохранённый договор</button>
        </div>
      ) : null}

      <fieldset disabled={pending || uploading || Boolean(savedId) || finished} className="space-y-5">

      {mode === "create" ? (
        <fieldset className="space-y-3">
          <legend className="label">Связь договора</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Клиент" error={err("clientId")}>
              <ClientPicker value={client} onChange={setClient} invalid={Boolean(err("clientId"))} />
            </Field>
            <Field label="Объект" error={err("propertyId")}>
              <PropertySelect value={property} onChange={setProperty} invalid={Boolean(err("propertyId"))} />
            </Field>
          </div>
          {deal ? (
            <p className="text-sm text-slate-600">
              Сделка: <span className="font-medium">{deal.label}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-400">Укажите хотя бы одну связь: клиента, объект или сделку.</p>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Тип договора" required error={err("agreementType")}>
          <SelectInput value={v.agreementType} onChange={(x) => set("agreementType", x)} options={TYPES} />
        </Field>
        <Field label="Статус" required error={err("status")}>
          <SelectInput value={v.status} onChange={(x) => set("status", x)} options={statusOptions} />
        </Field>
        <Field label="Номер" error={err("agreementNumber")}>
          <input className="input" value={v.agreementNumber} onChange={(e) => set("agreementNumber", e.target.value)} />
        </Field>
        <Field label="Эксклюзивный" error={err("isExclusive")}>
          <SelectInput
            value={v.isExclusive}
            onChange={(x) => set("isExclusive", x as AgreementFormValue["isExclusive"])}
            options={[
              { value: "true", label: "Да" },
              { value: "false", label: "Нет" },
            ]}
            placeholder="Не указано"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Дата подписания" required={v.status === "signed"} error={err("signedAt")}>
          <input type="date" className={`input ${err("signedAt") ? "input-error" : ""}`} value={v.signedAt} onChange={(e) => set("signedAt", e.target.value)} />
        </Field>
        <Field label="Действует с" error={err("validFrom")}>
          <input type="date" className="input" value={v.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
        </Field>
        <Field label="Действует до" error={err("validUntil")}>
          <input type="date" className={`input ${err("validUntil") ? "input-error" : ""}`} value={v.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
        </Field>
        {mode === "create" && v.validUntil ? (
          <Field label="Напомнить о сроке" hint="Задача «Проверка договора» ответственному">
            <SelectInput value={reminder} onChange={setReminder} options={REMINDERS} placeholder="Не напоминать" />
          </Field>
        ) : null}
      </div>

      <fieldset className={`rounded-md border p-3 ${legalRequired ? "border-brand-100 bg-brand-50/40" : "border-slate-200"}`}>
        <legend className="px-1 text-xs font-semibold text-slate-600">Юридическое лицо агентства</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="ИП/ООО" required={legalRequired} error={err("legalEntityId")} hint={legalRequired ? undefined : "Обязательно при статусе «Подписан», если договор от имени агентства"}>
            <SelectInput value={v.legalEntityId} onChange={(x) => set("legalEntityId", x)} options={options.legalEntities} placeholder="Не выбрано" invalid={Boolean(err("legalEntityId"))} />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.onBehalfOfCompany} onChange={(e) => set("onBehalfOfCompany", e.target.checked)} /> Договор оформляется от имени агентства (ИП/ООО)
          </label>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Тип комиссии" error={err("commissionType")}>
          <SelectInput value={v.commissionType} onChange={(x) => set("commissionType", x)} options={options.commissionTypes} placeholder="—" />
        </Field>
        <Field label="Комиссия (сумма или процент)" error={err("commissionValue")}>
          <input className={`input ${err("commissionValue") ? "input-error" : ""}`} inputMode="decimal" value={v.commissionValue} onChange={(e) => set("commissionValue", e.target.value)} />
        </Field>
        <Field label="Условия комиссии" error={err("commissionNotes")}>
          <input className="input" value={v.commissionNotes} onChange={(e) => set("commissionNotes", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ABSENT.includes(v.status) || v.absenceReasonCode ? (
          <Field label="Причина отсутствия договора / отказа" error={err("absenceReasonCode")} hint="Укажите, если причина известна">
            <SelectInput value={v.absenceReasonCode} onChange={(x) => set("absenceReasonCode", x)} options={options.absenceReasons} placeholder="—" />
          </Field>
        ) : null}
        <Field label="Что требуется сделать" error={err("actionRequired")} hint="Договор попадёт в фильтр «Требуют действия»" className={ABSENT.includes(v.status) || v.absenceReasonCode ? "" : "md:col-span-2"}>
          <input className="input" value={v.actionRequired} onChange={(e) => set("actionRequired", e.target.value)} placeholder="Например: подписать продление, получить скан" />
        </Field>
      </div>

      <Field label="Примечания" error={err("notes")}>
        <textarea className="input min-h-20" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      {mode === "create" && options.users.length ? (
        <Field label="Ответственный" hint="По умолчанию — вы" error={err("responsibleUserId")} className="max-w-sm">
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={options.users} placeholder="Я" />
        </Field>
      ) : null}

      {mode === "create" && uploadPolicy ? (
        <section aria-label="Файлы договора" className="space-y-3">
          <h2 className="label">Документы договора</h2>
          <p className="text-sm text-slate-600">Файлы будут загружены после сохранения договора. До {uploadPolicy.maxMb} МБ на файл. Форматы: {uploadPolicy.accept}.</p>
          <FilePicker label="Выбрать файлы договора" multiple disabled={pending || uploading || Boolean(savedId) || finished} accept={uploadPolicy.accept} selectedCount={files.length} onFiles={(chosen) => {
            setFiles((current) => [...current, ...Array.from(chosen ?? []).map((file) => ({ file, documentTypeCode: "agreement" }))]);
          }} />
          {files.map((item, i) => {
            const extension = `.${item.file.name.split(".").pop()?.toLowerCase()}`;
            const invalid = item.file.size === 0 ? "Пустой файл" : item.file.size > uploadPolicy.maxMb * 1024 * 1024 ? `Файл больше ${uploadPolicy.maxMb} МБ` : !uploadPolicy.accept.split(",").includes(extension) ? "Недопустимый формат файла" : null;
            return <div key={i} className="flex flex-wrap items-center gap-2">
              <span>{item.file.name}</span>
              <label className="text-sm">Тип файла {item.file.name}<SelectInput value={item.documentTypeCode} options={optionsOf("documentType")} onChange={(documentTypeCode) => setFiles((current) => current.map((f, index) => index === i ? { ...f, documentTypeCode } : f))} /></label>
              <button type="button" className="btn btn-sm" onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}>Убрать {item.file.name}</button>
              {invalid ? <span className="field-error" role="alert">{invalid}</span> : null}
            </div>;
          })}
        </section>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton pending={pending || uploading}>{mode === "create" ? "Создать договор" : "Сохранить"}</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
      </fieldset>
    </form>
  );
}
