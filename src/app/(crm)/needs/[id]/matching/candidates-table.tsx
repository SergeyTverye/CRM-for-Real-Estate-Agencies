"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";

/**
 * Таблица кандидатов рабочего места подбора (ТЗ 37.19): объяснимый score, отметка
 * «уже предлагался», групповые действия. Контакты собственника сюда не передаются.
 */

export interface CandidateRow {
  id: string;
  address: string;
  district: string | null;
  typeText: string;
  operationText: string;
  sourceType: string;
  sourceText: string;
  areaText: string;
  priceText: string;
  pricePerSqmText: string;
  status: string;
  statusText: string;
  extraText: string;
  responsible: string | null;
  score: number;
  criteria: { key: string; label: string; ok: boolean | null }[];
  previous: { status: string; statusText: string; offeredAtText: string; reasonText: string | null } | null;
}

const ACTIVE_MATCH = new Set(["proposed", "interested", "showing_planned"]);

function scoreTone(score: number) {
  if (score >= 80) return "badge-green";
  if (score >= 50) return "badge-yellow";
  return "badge-gray";
}

function Criteria({ items }: { items: CandidateRow["criteria"] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {items.map((c) => (
        <span
          key={c.key}
          className={c.ok === true ? "text-green-700" : c.ok === false ? "text-red-700" : "text-slate-400"}
          title={c.ok === true ? "Соответствует" : c.ok === false ? "Не соответствует" : "Нет данных у объекта"}
        >
          {c.ok === true ? "✓" : c.ok === false ? "✗" : "?"} {c.label}
        </span>
      ))}
    </div>
  );
}

export function CandidatesTable({ needId, rows, canPropose, truncated, strict }: { needId: string; rows: CandidateRow[]; canPropose: boolean; truncated: boolean; strict: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, error, run } = useApiAction();
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function propose() {
    setNotice(null);
    const res = await run(() => apiCall<{ created: string[]; skipped: string[] }>("POST", `/api/v1/needs/${needId}/matches`, { propertyIds: selected, sourceCode: "matching", comment: comment || null }));
    if (res) {
      const parts = [`Предложено объектов: ${res.created.length}.`];
      if (res.skipped.length) parts.push(`Уже в активном подборе (пропущено): ${res.skipped.length}.`);
      setNotice(parts.join(" "));
      setSelected([]);
      setComment("");
      router.refresh();
    }
  }

  const offerHref = `/offers/new?needId=${needId}&propertyIds=${selected.join(",")}`;

  return (
    <div className="card">
      <div className="card-header flex-wrap">
        <h2 className="card-title">
          Подходящие объекты: {rows.length}
          {truncated ? <span className="ml-1 font-normal text-slate-500">(показаны первые {rows.length} — уточните фильтры)</span> : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Выбрано: {selected.length}</span>
          <input className="input w-56 py-1 text-xs" placeholder="Комментарий к предложению" value={comment} onChange={(e) => setComment(e.target.value)} disabled={!canPropose} />
          <button type="button" className="btn btn-sm btn-primary" disabled={!canPropose || selected.length === 0 || pending} onClick={() => void propose()}>
            {pending ? "Сохранение…" : "Предложить выбранные"}
          </button>
          {selected.length === 1 && canPropose ? (
            <Link className="btn btn-sm" href={`/showings/new?needId=${needId}&propertyId=${selected[0]}`}>
              Назначить показ
            </Link>
          ) : null}
          {selected.length ? (
            <Link className="btn btn-sm" href={offerHref}>
              Создать КП из выбранных
            </Link>
          ) : (
            <button type="button" className="btn btn-sm" disabled title="Отметьте объекты">
              Создать КП из выбранных
            </button>
          )}
        </div>
      </div>
      {error || notice ? (
        <div className="space-y-2 px-4 pt-3">
          <FormErrorBanner error={error} />
          {notice ? <div className="alert alert-success">{notice}</div> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <div className="text-sm font-medium text-slate-700">Подходящих активных объектов не найдено</div>
          <div className="max-w-md text-sm text-slate-500">
            {strict ? "Попробуйте режим «Все объекты нужного типа» или расширьте бюджет и площадь в параметрах потребности." : "В каталоге нет активных объектов нужного типа и операции. Добавьте объект внешнего рынка в каталог."}
          </div>
          <Link className="btn mt-2" href="/properties/new">
            Добавить объект в каталог
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                  />
                </th>
                <th>Объект</th>
                <th>Площадь</th>
                <th>Цена</th>
                <th>Цена за м²</th>
                <th>Соответствие</th>
                <th>Статус</th>
                <th>Ранее предлагался</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const checked = selected.includes(r.id);
                const prevActive = r.previous ? ACTIVE_MATCH.has(r.previous.status) : false;
                return (
                  <tr key={r.id} className={checked ? "bg-brand-50/60" : r.previous ? "bg-amber-50/40" : undefined}>
                    <td>
                      <input type="checkbox" aria-label={`Выбрать ${r.address}`} checked={checked} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="min-w-64">
                      <Link className="link font-medium" href={`/properties/${r.id}`} target="_blank">
                        {r.address}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[r.district, r.typeText, r.operationText, r.sourceText].filter(Boolean).join(" · ")}
                      </div>
                      {r.extraText ? <div className="text-xs text-slate-500">{r.extraText}</div> : null}
                    </td>
                    <td className="whitespace-nowrap">{r.areaText}</td>
                    <td className="whitespace-nowrap">{r.priceText}</td>
                    <td className="whitespace-nowrap">{r.pricePerSqmText}</td>
                    <td className="min-w-48">
                      <span className={`badge ${scoreTone(r.score)}`}>{r.score}%</span>
                      <Criteria items={r.criteria} />
                    </td>
                    <td>
                      <span className="text-sm">{r.statusText}</span>
                      {r.responsible ? <div className="text-xs text-slate-500">{r.responsible}</div> : null}
                    </td>
                    <td>
                      {r.previous ? (
                        <div className="text-sm">
                          <span className={`badge ${prevActive ? "badge-blue" : r.previous.status === "rejected" ? "badge-red" : "badge-gray"}`}>{r.previous.statusText}</span>
                          <div className="text-xs text-slate-500">{r.previous.offeredAtText}</div>
                          {r.previous.reasonText ? <div className="text-xs text-slate-600">Причина: {r.previous.reasonText}</div> : null}
                        </div>
                      ) : (
                        <span className="text-slate-400">нет</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
