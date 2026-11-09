"use client";
import { useState } from "react";
import type { DuplicateGroupDto } from "@/modules/listing-duplicates/application/duplicate-service";
import type { explainDuplicateGroup } from "@/modules/listing-duplicates/application/explanation-service";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { DuplicateDecisionDialog, decisionLabels, type DuplicateDecision } from "./decision-dialog";
const statusLabels: Record<string, string> = { probable: "Вероятное совпадение", confirmed: "Совпадение подтверждено", deferred: "Решение отложено", rejected: "Разные помещения", auto_exact: "Точное совпадение" };
const sourceLabels: Record<string, string> = { cian: "Циан", avito: "Авито", domclick: "Домклик", yandex: "Яндекс Недвижимость", onrealt: "OnRealt", mirkvartir: "Мир Квартир", youla: "Юла", web_search: "Веб-поиск" };
const units: Record<string, string> = { rub_total: "₽", rub_month: "₽/мес.", rub_year: "₽/год", rub_m2_month: "₽/м²/мес.", rub_m2_year: "₽/м²/год" };
const availability: Record<string, string> = { available: "Доступно", unavailable: "Недоступно", unknown: "Не проверено", withdrawn: "Снято" };
const date = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Novosibirsk" });
const money = (amount: string | null, unit: string | null) => amount === null ? "Цена неизвестна" : `${Number(amount).toLocaleString("ru-RU")} ${units[unit ?? ""] ?? "₽ (единица не уточнена)"}`;

export function ListingDuplicateGroupCard({ group: initial, onChanged }: { group: DuplicateGroupDto; onChanged?: (group: DuplicateGroupDto) => void }) {
  const [replacement, setReplacement] = useState<DuplicateGroupDto | null>(null);
  const group = replacement && replacement.updatedAt > initial.updatedAt ? replacement : initial;
  const [action, setAction] = useState<{ decision: DuplicateDecision; listingId?: string } | null>(null);
  const [explanation, setExplanation] = useState<Awaited<ReturnType<typeof explainDuplicateGroup>> | null>(null);
  const [paidConsent, setPaidConsent] = useState(false);
  const { pending, error, run } = useApiAction();
  const update = (g: DuplicateGroupDto) => { setReplacement(g); setExplanation(null); setAction(null); onChanged?.(g); };
  const reload = async () => { const g = await run(() => apiCall<DuplicateGroupDto>("GET", `/api/v1/listing-duplicates/${group.id}`)); if (g) update(g); };
  const active = group.members.filter(m => !m.releasedAt);
  return <article className="card space-y-3 p-4" aria-label="Группа вероятных дублей">
    <header><h3 className="font-semibold">Один предполагаемый объект — несколько объявлений</h3><p>{statusLabels[group.status] ?? "Требует проверки"} · Действующих объявлений: {active.length}</p></header>
    <p className="text-sm text-slate-600">Адрес и площадь сами по себе не доказывают идентичность. Объединение подтверждает сотрудник.</p>
    <FormErrorBanner error={error} onRetry={() => void reload()} />
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Площадка / адрес", "Цена", "Доступность", "Продавец", "История", "Действия"].map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead>
      <tbody>{group.members.map(m => <tr key={m.listingId} className={m.releasedAt ? "opacity-60" : ""}>
        <td className="p-2">{m.listing.url ? <a className="text-blue-700 underline" href={m.listing.url} target="_blank" rel="noopener noreferrer">{sourceLabels[m.listing.source] ?? "Площадка"}</a> : "Ссылка недоступна"}<div>{m.listing.address ?? "Адрес не указан"}</div><div>{m.listing.area ?? "?"} м² · этаж {m.listing.floor ?? "неизвестен"}</div>{m.releasedAt && <span>Исключено из группы</span>}</td>
        <td className="p-2">{money(m.listing.price, m.listing.priceUnit)}</td><td className="p-2">{availability[m.listing.availability] ?? "Требует проверки"}{m.listing.checkedAt && <div>{date(m.listing.checkedAt)}</div>}</td>
        <td className="p-2">{m.listing.sellerType === "owner" ? "Собственник (по данным площадки)" : m.listing.sellerType === "agent" ? "Посредник" : "Неизвестен"}</td>
        <td className="p-2"><details><summary>История цен ({m.listing.priceHistory.length})</summary><ul>{m.listing.priceHistory.map((p, i) => <li key={i}>{date(p.at)}: {money(p.price, p.priceUnit)}</li>)}</ul></details></td>
        <td className="p-2">{!m.releasedAt && group.status !== "rejected" && <button type="button" className="btn btn-sm" onClick={() => setAction({ decision: "split", listingId: m.listingId })}>Разъединить</button>}</td>
      </tr>)}</tbody></table></div>
    <details><summary>Основания группировки</summary>{group.evidence.pairs.map((p, i) => <div key={`${p.a}:${p.b}`} className="my-2 border-t pt-2"><strong>Пара {i + 1} · оценка {p.score}/100</strong><ul>{p.features.map((f, n) => <li key={n}>{f.feature}: {f.state === "matched" ? "совпало" : f.state === "contradicted" ? "различается" : "неизвестно"} — {f.explanation}</li>)}</ul></div>)}</details>
    {group.status !== "rejected" && <div className="flex flex-wrap gap-2">{(["confirm", "different", "defer"] as const).map(decision => <button type="button" className="btn btn-sm" key={decision} disabled={pending || (decision === "confirm" && active.length < 2)} onClick={() => setAction({ decision })}>{decisionLabels[decision]}</button>)}</div>}
    {["probable", "deferred"].includes(group.status) && group.evidence.pairs.length > 0 && <div className="space-y-2 border-t pt-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paidConsent} onChange={e => setPaidConsent(e.target.checked)} />Разрешаю платный запрос объяснения ИИ в пределах лимитов CRM</label>
      <button type="button" className="btn btn-sm" disabled={pending || !paidConsent} onClick={async () => {
        const result = await run(() => apiCall<Awaited<ReturnType<typeof explainDuplicateGroup>>>("POST", `/api/v1/listing-duplicates/${group.id}/explanation`, { confirmedPaid: true, expectedUpdatedAt: group.updatedAt }));
        if (result) setExplanation(result);
      }}>{pending ? "Получение объяснения…" : "Объяснить спорные признаки с ИИ"}</button>
      {explanation && <div role="status"><p>Объяснение ИИ. Проверьте признаки и подтвердите решение вручную.</p><ul>{explanation.evidence.map((e, i) => <li key={i}>{e.criterion}: {e.quote ?? "Недостаточно сведений"}</li>)}</ul>{explanation.truncated && <p>Показаны первые 20 пар.</p>}</div>}
    </div>}
    <details><summary>Решения сотрудников ({group.decisions.length})</summary><ul>{group.decisions.map(d => <li key={d.id}>{date(d.decidedAt)} · {d.decider.displayName} · {decisionLabels[d.decision as DuplicateDecision] ?? "Решение"}</li>)}</ul></details>
    {action && <DuplicateDecisionDialog key={`${group.id}:${group.updatedAt}:${action.decision}:${action.listingId ?? ""}`} group={group} {...action} onDone={update} onClose={() => setAction(null)} onReload={() => void reload()} />}
  </article>;
}

export function ListingDuplicateGroups({ groups, loading = false, error = null, onChanged }: { groups: DuplicateGroupDto[]; loading?: boolean; error?: string | null; onChanged?: (group: DuplicateGroupDto) => void }) {
  if (loading) return <p role="status">Загрузка групп объявлений…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!groups.length) return <p className="text-sm text-slate-500">Вероятных межплощадочных дублей не найдено.</p>;
  return <div className="space-y-4">{groups.map(g => <ListingDuplicateGroupCard key={g.id} group={g} onChanged={onChanged} />)}</div>;
}
