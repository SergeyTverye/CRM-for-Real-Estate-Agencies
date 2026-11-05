"use client";

import { requestConfirmation } from "@/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal, SelectInput } from "../client-kit";

export interface LegalEntityRow {
  id: string;
  entityType: string;
  displayName: string;
  isActive: boolean;
  usage: { deals: number; agreements: number; offers: number };
}

const TYPES = [
  { value: "IP", label: "ИП" },
  { value: "LLC", label: "ООО" },
];
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? t;

function RenameForm({ item, onDone, onCancel }: { item: LegalEntityRow; onDone: () => void; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState(item.displayName);
  const { pending, error, run, fieldError } = useApiAction();
  const used = item.usage.deals + item.usage.agreements + item.usage.offers;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (used && !await requestConfirmation(`Субъект указан в ${used} документах (сделки, договоры, КП). Новое наименование отобразится и в них. Продолжить?`)) return;
        const res = await run(() => apiCall("PATCH", `/api/v1/admin/legal-entities/${item.id}`, { displayName }));
        if (res !== undefined) onDone();
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Форма" hint="Форма ИП/ООО не меняется — при смене формы заведите новый субъект">
        <input className="input" value={typeLabel(item.entityType)} disabled />
      </Field>
      <Field label="Наименование" required error={fieldError("displayName")}>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || displayName === item.displayName}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

/** Юридические субъекты предприятия (ИП/ООО) для сделок, договоров и КП. Удаления нет — только деактивация. */
export function LegalEntitiesPanel({ items }: { items: LegalEntityRow[] }) {
  const router = useRouter();
  const [entityType, setEntityType] = useState("LLC");
  const [displayName, setDisplayName] = useState("");
  const [editing, setEditing] = useState<LegalEntityRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const add = useApiAction();
  const row = useApiAction();

  async function toggle(it: LegalEntityRow) {
    const msg = it.isActive
      ? `Деактивировать «${it.displayName}»? Его нельзя будет выбрать в новых сделках, договорах и КП; существующие записи сохранятся.`
      : `Снова сделать «${it.displayName}» доступным для выбора?`;
    if (!await requestConfirmation(msg)) return;
    setBusyId(it.id);
    const res = await row.run(() => apiCall("PATCH", `/api/v1/admin/legal-entities/${it.id}`, { isActive: !it.isActive }));
    setBusyId(null);
    if (res !== undefined) router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Юридические субъекты · {items.length}</h2>
        </div>
        {row.error ? (
          <div className="px-4 pt-3">
            <FormErrorBanner error={row.error} />
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">Субъектов нет — добавьте ИП или ООО, от имени которых оформляются договоры и сделки.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Форма</th>
                <th>Наименование</th>
                <th>Используется</th>
                <th>Состояние</th>
                <th className="w-0" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={it.isActive ? "" : "text-slate-400"}>
                  <td>{typeLabel(it.entityType)}</td>
                  <td className="font-medium">{it.displayName}</td>
                  <td className="text-xs">
                    сделок: {it.usage.deals} · договоров: {it.usage.agreements} · КП: {it.usage.offers}
                  </td>
                  <td>
                    <span className={`badge ${it.isActive ? "badge-green" : "badge-gray"}`}>{it.isActive ? "Активен" : "Неактивен"}</span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          row.setError(null);
                          setEditing(it);
                        }}
                      >
                        Переименовать
                      </button>
                      <button type="button" className={`btn btn-sm ${it.isActive ? "btn-danger" : ""}`} disabled={busyId === it.id} onClick={() => void toggle(it)}>
                        {it.isActive ? "Деактивировать" : "Активировать"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Добавить субъект</h2>
        </div>
        <form
          className="card-body space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await add.run(() => apiCall("POST", "/api/v1/admin/legal-entities", { entityType, displayName }));
            if (res !== undefined) {
              setDisplayName("");
              router.refresh();
            }
          }}
        >
          <FormErrorBanner error={add.error} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Форма" required error={add.fieldError("entityType")}>
              <SelectInput value={entityType} onChange={setEntityType} options={TYPES} />
            </Field>
            <Field label="Наименование" required error={add.fieldError("displayName")} className="md:col-span-3">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={entityType === "IP" ? "ИП Фамилия И. О." : "ООО «Название»"} />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={add.pending}>
            {add.pending ? "Добавление…" : "Добавить"}
          </button>
        </form>
      </section>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Юридический субъект">
        {editing ? (
          <RenameForm
            item={editing}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
