"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction, useUnsavedChangesWarning } from "../hooks";
import { Field, FormErrorBanner, SubmitButton } from "../form";
import { DateTimeInput, SelectInput, type Option } from "../client-kit";
import { ClientPicker, type ClientPick } from "./need-pickers";
import { NeedPicker, PropertySelect, type NeedLabels, type NeedPick, type PropertyPick } from "./deal-pickers";

/**
 * Открытие сделки (UC-07, ТЗ 17.5, 29.7): объект, ИП/ООО, статус, дата, цена, участники
 * (клиент CRM или внешний участник) и отдельные записи комиссий.
 */

const ROLES = optionsOf("dealPartyRole");
const OPEN_STATUSES = optionsOf("dealStatus").filter((o) => !["completed", "cancelled"].includes(o.value));
const COMMISSION_STATUSES = optionsOf("commissionStatus");
const MONEY_RE = /^\d{1,14}([.,]\d{1,2})?$/;

interface PartyDraft {
  key: string;
  kind: "client" | "external";
  client: ClientPick | null;
  externalPartyName: string;
  partyRole: string;
  comment: string;
}

interface CommissionDraft {
  key: string;
  amount: string;
  status: string;
  dueAt: string;
  receivedAt: string;
  payerIndex: string;
  comment: string;
}

let seq = 0;
const nextKey = () => `k${++seq}`;

function newParty(client: ClientPick | null = null, partyRole = "buyer"): PartyDraft {
  return { key: nextKey(), kind: "client", client, externalPartyName: "", partyRole, comment: "" };
}

const newCommission = (): CommissionDraft => ({ key: nextKey(), amount: "", status: "planned", dueAt: "", receivedAt: "", payerIndex: "", comment: "" });

const cleanMoney = (s: string) => s.replace(/\s/g, "").replace(",", ".");

function partyName(p: PartyDraft, i: number): string {
  const name = p.kind === "client" ? p.client?.displayName : p.externalPartyName;
  const role = ROLES.find((r) => r.value === p.partyRole)?.label ?? p.partyRole;
  return `${i + 1}. ${role}${name ? `: ${name}` : ""}`;
}

export function NewDealForm({
  timeZone,
  legalEntities,
  users,
  labels,
  initialProperty,
  initialNeed,
  initialParties,
  initialLegalEntityId,
}: {
  timeZone: string;
  legalEntities: Option[];
  users: Option[];
  labels: NeedLabels;
  initialProperty: PropertyPick | null;
  initialNeed: NeedPick | null;
  initialParties: { client: ClientPick | null; partyRole: string }[];
  initialLegalEntityId: string;
}) {
  const router = useRouter();
  const [property, setProperty] = useState<PropertyPick | null>(initialProperty);
  const [need, setNeed] = useState<NeedPick | null>(initialNeed);
  const [legalEntityId, setLegalEntity] = useState(initialLegalEntityId);
  const [status, setStatus] = useState("draft");
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString());
  const [dealPrice, setDealPrice] = useState(initialProperty?.price ?? "");
  const [responsibleUserId, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [parties, setParties] = useState<PartyDraft[]>(() => (initialParties.length ? initialParties.map((p) => newParty(p.client, p.partyRole)) : [newParty()]));
  const [commissions, setCommissions] = useState<CommissionDraft[]>([]);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = notes !== "" || commissions.length > 0 || parties.some((p) => p.externalPartyName || (p.client && !initialParties.some((x) => x.client?.id === p.client?.id)));
  useUnsavedChangesWarning(dirty && !pending);

  const setParty = (i: number, patch: Partial<PartyDraft>) => setParties((s) => s.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setCommission = (i: number, patch: Partial<CommissionDraft>) => setCommissions((s) => s.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeParty = (i: number) => {
    setParties((s) => s.filter((_, j) => j !== i));
    // Плательщик комиссии указывается индексом участника — сдвигаем ссылки.
    setCommissions((s) => s.map((c) => (c.payerIndex === "" ? c : Number(c.payerIndex) === i ? { ...c, payerIndex: "" } : Number(c.payerIndex) > i ? { ...c, payerIndex: String(Number(c.payerIndex) - 1) } : c)));
  };

  async function submit() {
    const fe: Record<string, string[]> = {};
    if (!property) fe.propertyId = ["Выберите объект сделки"];
    if (!legalEntityId) fe.legalEntityId = ["Выберите ИП/ООО, от имени которого ведётся сделка"];
    if (dealPrice && !MONEY_RE.test(cleanMoney(dealPrice))) fe.dealPrice = ["Сумма: неотрицательное число"];
    if (parties.length === 0) fe.parties = ["Добавьте хотя бы одного участника"];
    parties.forEach((p, i) => {
      if (p.kind === "client" && !p.client) fe[`parties.${i}.clientId`] = ["Выберите клиента"];
      if (p.kind === "external" && !p.externalPartyName.trim()) fe[`parties.${i}.externalPartyName`] = ["Укажите участника"];
    });
    commissions.forEach((c, i) => {
      if (!MONEY_RE.test(cleanMoney(c.amount))) fe[`commissions.${i}.amount`] = ["Укажите сумму комиссии"];
    });
    if (Object.keys(fe).length) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: fe });
      return;
    }
    const res = await run(() =>
      apiCall<{ id: string }>("POST", "/api/v1/deals", {
        propertyId: property!.id,
        legalEntityId,
        responsibleUserId: responsibleUserId || undefined,
        clientNeedId: need?.id,
        status,
        openedAt: openedAt || null,
        dealPrice: dealPrice ? cleanMoney(dealPrice) : null,
        notes: notes || null,
        parties: parties.map((p) =>
          p.kind === "client" ? { clientId: p.client?.id, partyRole: p.partyRole, comment: p.comment || null } : { externalPartyName: p.externalPartyName, partyRole: p.partyRole, comment: p.comment || null },
        ),
        commissions: commissions.map((c) => ({
          amount: cleanMoney(c.amount),
          status: c.status,
          dueAt: c.dueAt || null,
          receivedAt: ["received", "partially_received"].includes(c.status) ? c.receivedAt || null : null,
          payerPartyIndex: c.payerIndex === "" ? undefined : Number(c.payerIndex),
          comment: c.comment || null,
        })),
      }),
    );
    if (res) router.push(`/deals/${res.id}`);
  }

  const payerOptions = parties.map((p, i) => ({ value: String(i), label: partyName(p, i) }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Объект" required error={fieldError("propertyId")}>
          <PropertySelect value={property} onChange={setProperty} invalid={Boolean(fieldError("propertyId"))} />
        </Field>
        <Field label="Потребность клиента" hint="Необязательно; этап потребности перейдёт в «Сделка»" error={fieldError("clientNeedId")}>
          <NeedPicker value={need} onChange={setNeed} labels={labels} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="ИП/ООО" required error={fieldError("legalEntityId")} className="md:col-span-2">
          <SelectInput value={legalEntityId} onChange={setLegalEntity} options={legalEntities} placeholder="—" invalid={Boolean(fieldError("legalEntityId"))} />
        </Field>
        <Field label="Статус" required error={fieldError("status")}>
          <SelectInput value={status} onChange={setStatus} options={OPEN_STATUSES} />
        </Field>
        <Field label="Дата открытия" error={fieldError("openedAt")}>
          <DateTimeInput value={openedAt} onChange={setOpenedAt} timeZone={timeZone} />
        </Field>
        <Field label="Цена сделки, ₽" error={fieldError("dealPrice")}>
          <input className={`input ${fieldError("dealPrice") ? "input-error" : ""}`} inputMode="decimal" value={dealPrice} onChange={(e) => setDealPrice(e.target.value)} />
        </Field>
        {users.length ? (
          <Field label="Ответственный" hint="По умолчанию — вы" error={fieldError("responsibleUserId")} className="md:col-span-2">
            <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Я" />
          </Field>
        ) : null}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Участники сделки</h3>
          <button type="button" className="btn btn-sm" onClick={() => setParties((s) => [...s, newParty(null, "seller")])}>
            + Участник
          </button>
        </div>
        {fieldError("parties") ? <p className="field-error">{fieldError("parties")}</p> : null}
        {parties.map((p, i) => (
          <div key={p.key} className="rounded-md border border-slate-200 p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <Field label="Роль" required error={fieldError(`parties.${i}.partyRole`)} className="md:col-span-3">
                <SelectInput value={p.partyRole} onChange={(partyRole) => setParty(i, { partyRole })} options={ROLES} />
              </Field>
              <Field label="Кто" className="md:col-span-3">
                <SelectInput
                  value={p.kind}
                  onChange={(k) => setParty(i, { kind: k as PartyDraft["kind"] })}
                  options={[
                    { value: "client", label: "Клиент CRM" },
                    { value: "external", label: "Внешний участник" },
                  ]}
                />
              </Field>
              {p.kind === "client" ? (
                <Field label="Клиент" required error={fieldError(`parties.${i}.clientId`)} className="md:col-span-6">
                  <ClientPicker value={p.client} onChange={(client) => setParty(i, { client })} invalid={Boolean(fieldError(`parties.${i}.clientId`))} />
                </Field>
              ) : (
                <Field label="Наименование / ФИО" required error={fieldError(`parties.${i}.externalPartyName`)} className="md:col-span-6">
                  <input className={`input ${fieldError(`parties.${i}.externalPartyName`) ? "input-error" : ""}`} value={p.externalPartyName} onChange={(e) => setParty(i, { externalPartyName: e.target.value })} />
                </Field>
              )}
              <Field label="Комментарий" className="md:col-span-10">
                <input className="input" value={p.comment} onChange={(e) => setParty(i, { comment: e.target.value })} />
              </Field>
              <div className="flex items-end justify-end md:col-span-2">
                <button type="button" className="btn btn-sm btn-link text-red-700" disabled={parties.length === 1} onClick={() => removeParty(i)}>
                  Убрать
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Комиссии</h3>
          <button type="button" className="btn btn-sm" onClick={() => setCommissions((s) => [...s, newCommission()])}>
            + Комиссия
          </button>
        </div>
        {commissions.length === 0 ? <p className="text-sm text-slate-500">Каждое обязательство — отдельная запись (сумма, статус, срок, плательщик). Можно добавить позже в карточке сделки.</p> : null}
        {commissions.map((c, i) => (
          <div key={c.key} className="rounded-md border border-slate-200 p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <Field label="Сумма, ₽" required error={fieldError(`commissions.${i}.amount`)} className="md:col-span-3">
                <input className={`input ${fieldError(`commissions.${i}.amount`) ? "input-error" : ""}`} inputMode="decimal" value={c.amount} onChange={(e) => setCommission(i, { amount: e.target.value })} />
              </Field>
              <Field label="Статус" className="md:col-span-3">
                <SelectInput value={c.status} onChange={(s) => setCommission(i, { status: s })} options={COMMISSION_STATUSES} />
              </Field>
              <Field label="Срок оплаты" error={fieldError(`commissions.${i}.dueAt`)} className="md:col-span-3">
                <input type="date" className="input" value={c.dueAt} onChange={(e) => setCommission(i, { dueAt: e.target.value })} />
              </Field>
              {["received", "partially_received"].includes(c.status) ? (
                <Field label="Получена" error={fieldError(`commissions.${i}.receivedAt`)} className="md:col-span-3">
                  <DateTimeInput value={c.receivedAt} onChange={(receivedAt) => setCommission(i, { receivedAt })} timeZone={timeZone} />
                </Field>
              ) : null}
              <Field label="Плательщик" className="md:col-span-4">
                <SelectInput value={c.payerIndex} onChange={(payerIndex) => setCommission(i, { payerIndex })} options={payerOptions} placeholder="—" />
              </Field>
              <Field label="Комментарий" className="md:col-span-6">
                <input className="input" value={c.comment} onChange={(e) => setCommission(i, { comment: e.target.value })} />
              </Field>
              <div className="flex items-end justify-end md:col-span-2">
                <button type="button" className="btn btn-sm btn-link text-red-700" onClick={() => setCommissions((s) => s.filter((_, j) => j !== i))}>
                  Убрать
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <Field label="Примечания" error={fieldError("notes")}>
        <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex gap-2">
        <SubmitButton pending={pending}>Открыть сделку</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
