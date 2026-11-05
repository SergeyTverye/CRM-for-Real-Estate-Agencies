"use client";

import { requestConfirmation } from "@/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal } from "../client-kit";

export interface DictionaryRow {
  id: string;
  code: string;
  displayName: string;
  isActive: boolean;
  sortOrder: number;
}

/** Новый порядок: если текущие sortOrder строго возрастают — меняются местами два значения, иначе категория перенумеровывается шагом 10. */
function reorderPlan(items: DictionaryRow[], from: number, to: number): { id: string; sortOrder: number }[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const strictlyIncreasing = items.every((it, i) => i === 0 || it.sortOrder > items[i - 1]!.sortOrder);
  if (strictlyIncreasing && Math.abs(from - to) === 1) {
    return [
      { id: items[from]!.id, sortOrder: items[to]!.sortOrder },
      { id: items[to]!.id, sortOrder: items[from]!.sortOrder },
    ];
  }
  return next.map((it, i) => ({ id: it.id, sortOrder: (i + 1) * 10 })).filter((p) => items.find((it) => it.id === p.id)!.sortOrder !== p.sortOrder);
}

function RenameForm({ item, onDone, onCancel }: { item: DictionaryRow; onDone: () => void; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState(item.displayName);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => apiCall("PATCH", `/api/v1/admin/dictionaries/${item.id}`, { displayName, sortOrder }));
        if (res !== undefined) onDone();
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Код" hint="Код стабилен: на него ссылаются записи, импорт и отчёты — он не меняется">
        <input className="input font-mono" value={item.code} disabled />
      </Field>
      <Field label="Название" required error={fieldError("displayName")}>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Порядок сортировки" error={fieldError("sortOrder")}>
        <input className="input" type="number" min={0} max={10000} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

/** Значения одного бизнес-справочника (ТЗ 40.9): добавить, переименовать, упорядочить, (де)активировать. Удаления нет. */
export function DictionaryEditor({ category, categoryLabel, items }: { category: string; categoryLabel: string; items: DictionaryRow[] }) {
  const router = useRouter();
  const nextOrder = (items.reduce((m, i) => Math.max(m, i.sortOrder), 0) || 0) + 10;
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sortOrder, setSortOrder] = useState(String(nextOrder));
  const [editing, setEditing] = useState<DictionaryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const add = useApiAction();
  const row = useApiAction();

  async function move(index: number, dir: -1 | 1) {
    const plan = reorderPlan(items, index, index + dir);
    setBusy(true);
    await row.run(async () => {
      for (const p of plan) await apiCall("PATCH", `/api/v1/admin/dictionaries/${p.id}`, { sortOrder: p.sortOrder });
      return true;
    });
    setBusy(false);
    // Даже при частичной ошибке показываем фактический порядок.
    router.refresh();
  }

  async function toggle(it: DictionaryRow) {
    const msg = it.isActive
      ? `Деактивировать значение «${it.displayName}»? Оно перестанет предлагаться в формах, но сохранится в существующих записях и истории.`
      : `Снова сделать значение «${it.displayName}» доступным для выбора?`;
    if (!await requestConfirmation(msg)) return;
    setBusy(true);
    const res = await row.run(() => apiCall("PATCH", `/api/v1/admin/dictionaries/${it.id}`, { isActive: !it.isActive }));
    setBusy(false);
    if (res !== undefined) router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            {categoryLabel} <span className="ml-1 font-mono text-xs font-normal text-slate-400">{category}</span>
          </h2>
          <span className="text-xs text-slate-500">
            активных: {items.filter((i) => i.isActive).length} из {items.length}
          </span>
        </div>
        {row.error ? (
          <div className="px-4 pt-3">
            <FormErrorBanner error={row.error} />
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">Значений нет — добавьте первое значение ниже.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-0">Порядок</th>
                <th>Название</th>
                <th>Код</th>
                <th>Состояние</th>
                <th className="w-0" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className={it.isActive ? "" : "text-slate-400"}>
                  <td className="whitespace-nowrap">
                    <span className="mr-2 inline-block w-10 text-right text-xs text-slate-500">{it.sortOrder}</span>
                    <button type="button" className="btn btn-sm" disabled={busy || i === 0} onClick={() => void move(i, -1)} aria-label={`Поднять «${it.displayName}»`}>
                      ↑
                    </button>{" "}
                    <button type="button" className="btn btn-sm" disabled={busy || i === items.length - 1} onClick={() => void move(i, 1)} aria-label={`Опустить «${it.displayName}»`}>
                      ↓
                    </button>
                  </td>
                  <td className="font-medium">{it.displayName}</td>
                  <td className="font-mono text-xs">{it.code}</td>
                  <td>
                    <span className={`badge ${it.isActive ? "badge-green" : "badge-gray"}`}>{it.isActive ? "Активно" : "Неактивно"}</span>
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
                      <button type="button" className={`btn btn-sm ${it.isActive ? "btn-danger" : ""}`} disabled={busy} onClick={() => void toggle(it)}>
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
          <h2 className="card-title">Добавить значение</h2>
        </div>
        <form
          className="card-body space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await add.run(() => apiCall("POST", "/api/v1/admin/dictionaries", { category, code, displayName, sortOrder }));
            if (res !== undefined) {
              setCode("");
              setDisplayName("");
              setSortOrder(String(nextOrder + 10));
              router.refresh();
            }
          }}
        >
          <FormErrorBanner error={add.error} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Название" required error={add.fieldError("displayName")} className="md:col-span-2">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Как увидят пользователи" />
            </Field>
            <Field label="Код" required error={add.fieldError("code")} hint="латиница a–z, цифры, _ ; потом не меняется">
              <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="new_value" />
            </Field>
            <Field label="Порядок" error={add.fieldError("sortOrder")}>
              <input className="input" type="number" min={0} max={10000} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={add.pending}>
            {add.pending ? "Добавление…" : "Добавить"}
          </button>
        </form>
      </section>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Значение справочника">
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
