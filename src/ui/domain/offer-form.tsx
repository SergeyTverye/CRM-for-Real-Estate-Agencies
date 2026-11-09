"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { labelOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction, useUnsavedChangesWarning } from "../hooks";
import { Field, FormErrorBanner, SubmitButton } from "../form";
import { DisclosureSection } from "../disclosure-section";
import { SelectInput, type Option } from "../client-kit";
import { NeedPicker, PropertySelect, type NeedLabels, type NeedPick, type PropertyPick } from "./deal-pickers";
import { itemFromPick, moneyText, type OfferFormValue, type OfferItemDraft, type OfferSuggestion } from "./deal-form-values";



export type { OfferFormValue, OfferItemDraft, OfferSuggestion };

const MONEY_RE = /^\d{1,14}([.,]\d{1,2})?$/;

function itemsPayload(items: OfferItemDraft[]) {
  return items.map((i) => ({
    propertyId: i.propertyId,
    priceSnapshot: i.price.replace(/\s/g, "") || null,
    termsSnapshot: i.terms.trim() || null,
    comment: i.comment.trim() || null,
  }));
}

export function OfferForm({
  mode,
  initial,
  initialNeed = null,
  labels,
  legalEntities,
  suggestions = [],
  offerId,
  updatedAt,
}: {
  mode: "create" | "edit";
  initial: OfferFormValue;
  initialNeed?: NeedPick | null;
  labels?: NeedLabels;
  legalEntities: Option[];
  suggestions?: OfferSuggestion[];
  offerId?: string;
  updatedAt?: string;
}) {
  const router = useRouter();
  const [need, setNeed] = useState<NeedPick | null>(initialNeed);
  const [v, setV] = useState<OfferFormValue>(initial);
  const [adding, setAdding] = useState<PropertyPick | null>(null);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial) || need?.id !== initialNeed?.id;
  useUnsavedChangesWarning(dirty && !pending);
  const set = <K extends keyof OfferFormValue>(k: K, val: OfferFormValue[K]) => setV((s) => ({ ...s, [k]: val }));
  const setItem = (idx: number, patch: Partial<OfferItemDraft>) => setV((s) => ({ ...s, items: s.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const move = (idx: number, dir: -1 | 1) =>
    setV((s) => {
      const items = [...s.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return s;
      [items[idx], items[j]] = [items[j]!, items[idx]!];
      return { ...s, items };
    });
  const remove = (idx: number) => setV((s) => ({ ...s, items: s.items.filter((_, i) => i !== idx) }));
  const addItem = (item: OfferItemDraft) => {
    if (v.items.some((i) => i.propertyId === item.propertyId)) return;
    setV((s) => ({ ...s, items: [...s.items, item] }));
  };
  const visibleSuggestions = need?.id === initialNeed?.id ? suggestions.filter((s) => !v.items.some((i) => i.propertyId === s.propertyId)) : [];

  async function submit() {
    const fe: Record<string, string[]> = {};
    if (mode === "create" && !need) fe.clientNeedId = ["Выберите потребность клиента"];
    if (v.items.length === 0) fe.items = ["Добавьте хотя бы один объект"];
    v.items.forEach((it, i) => {
      if (it.price && !MONEY_RE.test(it.price.replace(/\s/g, ""))) fe[`items.${i}.priceSnapshot`] = ["Сумма: неотрицательное число"];
    });
    if (Object.keys(fe).length) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: fe });
      return;
    }
    const common = {
      title: v.title || null,
      introText: v.introText || null,
      notes: v.notes || null,
      legalEntityId: v.legalEntityId || null,
      expiresAt: v.expiresAt || null,
      items: itemsPayload(v.items),
    };
    if (mode === "create") {
      const res = await run(() => apiCall<{ id: string }>("POST", "/api/v1/offers", { ...common, clientNeedId: need!.id }));
      if (res) router.push(`/offers/${res.id}`);
      return;
    }
    const res = await run(() => apiCall("PATCH", `/api/v1/offers/${offerId}`, { ...common, expectedUpdatedAt: updatedAt }));
    if (res) {
      router.push(`/offers/${offerId}`);
      router.refresh();
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
      {mode === "create" && labels ? (
        <Field label="Потребность клиента" required error={fieldError("clientNeedId")}>
          <NeedPicker value={need} onChange={setNeed} labels={labels} invalid={Boolean(fieldError("clientNeedId"))} />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Заголовок" error={fieldError("title")} className="md:col-span-2">
          <input className="input" value={v.title} placeholder="Коммерческое предложение" onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Действует до" error={fieldError("expiresAt")}>
          <input type="date" className="input" value={v.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
        </Field>
      </div>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Объекты в предложении</h3>
          <p className="text-xs text-slate-500">Порядок — кнопками ↑↓. Цена и условия фиксируются в КП; пустое поле — значение из карточки объекта на момент сохранения.</p>
        </div>
        {fieldError("items") ? <p className="field-error">{fieldError("items")}</p> : null}
        {v.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">Объекты не выбраны — найдите объект ниже или добавьте из подбора.</div>
        ) : (
          <ol className="space-y-2">
            {v.items.map((it, idx) => (
              <li key={it.propertyId} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{idx + 1}</span>
                    <span className="font-medium text-slate-900">{it.addressText}</span>
                    {it.currentPrice ? <span className="ml-2 text-xs text-slate-500">цена в карточке: {moneyText(it.currentPrice)}</span> : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="btn btn-sm" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Выше">
                      ↑
                    </button>
                    <button type="button" className="btn btn-sm" disabled={idx === v.items.length - 1} onClick={() => move(idx, 1)} aria-label="Ниже">
                      ↓
                    </button>
                    <button type="button" className="btn btn-sm btn-link text-red-700" onClick={() => remove(idx)}>
                      Исключить
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <Field label="Цена в КП, ₽" error={fieldError(`items.${idx}.priceSnapshot`)}>
                    <input
                      className={`input ${fieldError(`items.${idx}.priceSnapshot`) ? "input-error" : ""}`}
                      inputMode="decimal"
                      value={it.price}
                      placeholder={it.currentPrice ? `${it.currentPrice} (из карточки)` : "по запросу"}
                      onChange={(e) => setItem(idx, { price: e.target.value })}
                    />
                  </Field>
                  <Field label="Условия" error={fieldError(`items.${idx}.termsSnapshot`)} className="md:col-span-2">
                    <input className="input" value={it.terms} placeholder="из карточки объекта" onChange={(e) => setItem(idx, { terms: e.target.value })} />
                  </Field>
                  <Field label="Комментарий" error={fieldError(`items.${idx}.comment`)}>
                    <input className="input" value={it.comment} onChange={(e) => setItem(idx, { comment: e.target.value })} />
                  </Field>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="flex items-end gap-2">
          <Field label="Добавить объект" className="flex-1">
            <PropertySelect value={adding} onChange={setAdding} placeholder="Найдите объект по адресу…" />
          </Field>
          <button
            type="button"
            className="btn"
            disabled={!adding}
            onClick={() => {
              if (adding) addItem(itemFromPick(adding));
              setAdding(null);
            }}
          >
            + В предложение
          </button>
        </div>
        {visibleSuggestions.length ? (
          <div className="rounded-md bg-slate-50 p-2">
            <div className="mb-1 text-xs font-medium text-slate-600">Из подбора потребности</div>
            <ul className="space-y-1">
              {visibleSuggestions.map((s) => (
                <li key={s.propertyId} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {s.addressText}
                    <span className="ml-2 text-xs text-slate-500">
                      {moneyText(s.price)}
                      {s.area ? ` · ${s.area} м²` : ""} · {labelOf("matchStatus", s.matchStatus)}
                    </span>
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => addItem({ propertyId: s.propertyId, addressText: s.addressText, currentPrice: s.price, price: "", terms: "", comment: "" })}>
                    + Добавить
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <DisclosureSection title="Текст предложения и внутренние заметки" hint="Эти поля необязательны. Внутренние заметки клиенту не передаются." defaultOpen={Boolean(initial.introText || initial.notes)} error={[fieldError("introText"), fieldError("notes")].filter(Boolean).join("; ")}>
      <Field label="Вводный текст" hint="Попадёт в начало документа КП" error={fieldError("introText")}>
        <textarea className="input min-h-28" value={v.introText} onChange={(e) => set("introText", e.target.value)} />
      </Field>

      <Field label="Внутренние заметки" hint="В документ не попадают" error={fieldError("notes")}>
        <input className="input" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      </DisclosureSection>
      <Field label="От имени ИП или ООО" hint="Укажите перед подготовкой и отправкой предложения от агентства" error={fieldError("legalEntityId")}>
        <SelectInput value={v.legalEntityId} onChange={(x) => set("legalEntityId", x)} options={legalEntities} placeholder="Не выбрано" invalid={Boolean(fieldError("legalEntityId"))} />
      </Field>

      <div className="flex gap-2">
        <SubmitButton pending={pending}>{mode === "create" ? "Создать черновик КП" : "Сохранить черновик"}</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
