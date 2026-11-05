"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState } from "@/ui/components";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { SearchFilters, SOURCES, PURPOSES, type NormalizedListing, type CriterionEvaluation } from "@/modules/property-search/domain/types";

type Listing = { id: string; source: string; sourceMethod: string; url: string; address: string | null; priceRub: string | null; areaM2: string | null;
  floorRaw: string | null; lastSeenAt: string; propertyId: string | null; description?: string | null;
  verifications?: { availability: string; ownerConfirmed: boolean | null; priceConfirmed: boolean | null; verifiedAt: string; verifiedBy: string; nextCheckAt: string | null }[] };
type Result = { id: string; listingId: string; listing: Listing; verdict: string; criteria: CriterionEvaluation[]; isNew: boolean; priceChanged: boolean; snapshot?: NormalizedListing | null };
type Run = { id: string; status: string; fallbackReason: string | null; webSearchUsed: boolean; sources: { source: string; status: string; reason: string | null; resultCount: number }[]; results: Result[] };
type Bookmark = { id: string; status: string; note: string | null; listing: Listing };
type Saved = { id: string; name: string; needId: string | null; sources: string[]; filters: SearchFilters; updatedAt: string };
const purposes = { retail: "Торговля", psn_universal: "ПСН / универсальное", office: "Офис", production: "Производство", warehouse: "Склад", free_purpose: "Свободное назначение" };
const sourceLabels: Record<string, string> = { cian: "Циан", mirkvartir: "Мир Квартир", onrealt: "OnRealt", domclick: "Домклик", yandex: "Яндекс Недвижимость", youla: "Юла", avito: "Авито", web_search: "Веб-резерв" };
const statusLabels: Record<string, string> = { success: "Успешно", partial: "Частично", blocked: "Заблокирован", timeout: "Тайм-аут", unsupported_filter: "Фильтр не поддержан", error: "Ошибка", disabled: "Отключён" };
const split = (text: string) => text.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
const numberText = (v: string | number | null | undefined) => v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU");

export function SearchWorkspace({ initialFilters, initialNeedId, demoMode, aiEnabled, manualWebAllowed }: {
  initialFilters: SearchFilters; initialNeedId?: string; demoMode: boolean; aiEnabled: boolean; manualWebAllowed: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [needId, setNeedId] = useState(initialNeedId ?? "");
  const [query, setQuery] = useState("");
  const [clarification, setClarification] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState("confirmed");
  const [view, setView] = useState("cards");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [savedName, setSavedName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmedPaid, setConfirmedPaid] = useState(false);
  const [scenario, setScenario] = useState("success");
  const action = useApiAction();
  useUnsavedChangesWarning(dirty);
  function edit<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) { setFilters(current => ({ ...current, [key]: value })); setDirty(true); setConfirmedPaid(false); }
  async function search(nextFilters = filters, nextSavedId = savedId, nextNeedId = needId) {
    const result = await action.run(async () => {
      const checked = SearchFilters.safeParse(nextFilters);
      if (!checked.success) throw new ApiCallError(400, { code: "VALIDATION_ERROR", message: checked.error.issues.map(i => i.message).join("; "),
        fieldErrors: Object.fromEntries(checked.error.issues.map(i => [i.path.join("."), [i.message]])) });
      return apiCall<Run>("POST", "/api/v1/property-search/runs", { filters: checked.data, sources: checked.data.sources, needId: nextNeedId || undefined, savedSearchId: nextSavedId, confirmedPaid, demoScenario: scenario });
    });
    if (result) { setRun(result); setDirty(false); setFeedback("Поиск завершён"); setTab("confirmed"); }
  }
  async function openTab(value: string) {
    setTab(value);
    if (value === "bookmarks") { const rows = await action.run(() => apiCall<Bookmark[]>("GET", "/api/v1/property-search/bookmarks")); if (rows) setBookmarks(rows); }
    if (value === "saved") { const rows = await action.run(() => apiCall<Saved[]>("GET", "/api/v1/property-search/saved-searches")); if (rows) setSaved(rows); }
  }
  async function listingAction(listing: Listing, name: string, extra: Record<string, unknown> = {}) {
    const result = await action.run(() => apiCall<{ id?: string }>("POST", `/api/v1/property-search/listings/${listing.id}/${name}`, extra));
    if (result) {
      setFeedback(name === "transfer" ? "Объект сохранён в каталоге CRM" : name === "offer" ? "Объект добавлен в черновик КП" : "Изменения сохранены");
      if (run) { const updated = await action.run(() => apiCall<Run>("GET", `/api/v1/property-search/runs/${run.id}`)); if (updated) setRun(updated); }
    }
  }
  function ResultActions({ listing }: { listing: Listing }) {
    return <div className="flex flex-wrap gap-2">
      <button className="btn btn-secondary" disabled={action.pending} onClick={() => {
        const note = window.prompt("Заметка для личной закладки", ""); if (note !== null) void listingAction(listing, "bookmark", { status: "study", note });
      }}>В закладки</button>
      <button className="btn btn-secondary" disabled={!needId || action.pending} onClick={() => { const comment = window.prompt("Комментарий к кандидату", ""); if (comment !== null) void listingAction(listing, "selection", { needId, comment }); }}>В подборку клиента</button>
      <button className="btn btn-secondary" disabled={action.pending} onClick={() => {
        const due = window.prompt("Срок уточнения (ISO, например 2026-11-06T10:00:00+07:00)", new Date(Date.now() + 86400000).toISOString());
        if (due) void listingAction(listing, "clarify", { needId: needId || undefined, dueAt: due });
      }}>Уточнить</button>
      {listing.propertyId ? <Link className="btn btn-secondary" href={`/properties/${listing.propertyId}`}>Открыть объект CRM</Link> : <button className="btn btn-secondary" disabled={action.pending} onClick={() => {
        if (!window.confirm("Перенести проверенные данные в общий каталог CRM? При недостатке ключей подтвердите идентичность по первоисточнику.")) return;
        const address = listing.address || window.prompt("Проверенный адрес объекта");
        if (address) void listingAction(listing, "transfer", { confirmed: true, identityConfirmed: true, address, operation: filters.operation });
      }}>В каталог CRM</button>}
      <button className="btn btn-secondary" disabled={!needId || action.pending} onClick={() => { if (window.confirm("Зафиксировать фактическое предложение клиенту? Если объект ещё не перенесён, сначала используйте «В каталог CRM».")) void listingAction(listing, "propose", { needId }); }}>Предложить клиенту</button>
      <button className="btn btn-secondary" disabled={!needId || action.pending} onClick={() => void listingAction(listing, "offer", { needId })}>В КП</button>
      <button className="btn btn-secondary" disabled={action.pending} onClick={() => {
        const availability = window.prompt("Актуальность: available / reserved / withdrawn / unknown", "unknown");
        if (!availability) return;
        const owner = window.prompt("Собственник проверен: да / нет / неизвестно", "неизвестно");
        const price = window.prompt("Цена подтверждена: да / нет / неизвестно", "неизвестно");
        const next = window.prompt("Следующая проверка (ISO; можно оставить пустым)", "");
        void listingAction(listing, "verification", { availability, ownerConfirmed: owner === "да" ? true : owner === "нет" ? false : null,
          priceConfirmed: price === "да" ? true : price === "нет" ? false : null, nextCheckAt: next || null });
      }}>Проверка сотрудника</button>
    </div>;
  }
  const rows = (run?.results ?? []).filter(r => r.verdict === tab);
  return <div className="space-y-4">
    {demoMode && <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">Режим тестирования: записанные ответы площадок</div>}
    <Card title="Условия поиска">
      <label className="block font-medium" htmlFor="query">Опишите объект на русском</label>
      <textarea id="query" className="input mt-2 w-full" rows={2} value={query} onChange={e => { setQuery(e.target.value); setDirty(true); }} placeholder="Торговое помещение на первом этаже, отдельный вход, до 150 м²…" />
      <div className="my-3 flex flex-wrap items-center gap-3"><button className="btn btn-secondary" disabled={action.pending || !query.trim()} onClick={async () => {
        const parsed = await action.run(() => apiCall<{ filters: SearchFilters | null; clarificationQuestion: string | null }>("POST", "/api/v1/property-search/parse", { text: query, currentFilters: filters }));
        if (parsed) { setClarification(parsed.clarificationQuestion ?? ""); if (parsed.filters) { setFilters(parsed.filters); setDirty(true); setConfirmedPaid(false); setFeedback("Проверьте распознанные условия перед запуском"); } }
      }}>Разобрать с ИИ</button><span className="text-sm text-slate-500">{aiEnabled ? "Разбор и анализ используют настроенные лимиты ИИ" : "ИИ отключён · ручные фильтры доступны"}</span></div>
      {clarification && <p role="status" className="mb-3 rounded bg-amber-50 p-3">Уточнение: {clarification}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label>Город<input className="input mt-1 w-full" value={filters.city} onChange={e => edit("city", e.target.value)} /></label>
        <label>Операция<select className="input mt-1 w-full" value={filters.operation} onChange={e => { const op = e.target.value as "sale" | "rent"; setFilters(f => ({ ...f, operation: op, priceUnit: op === "sale" ? "rub_total" : "rub_month" })); setDirty(true); setConfirmedPaid(false); }}><option value="sale">Продажа</option><option value="rent">Аренда</option></select></label>
        <label>Единица цены<select className="input mt-1 w-full" value={filters.priceUnit ?? "rub_total"} onChange={e => edit("priceUnit", e.target.value as SearchFilters["priceUnit"])}>
          {(filters.operation === "sale" ? [["rub_total", "₽ за объект"]] : [["rub_month", "₽ в месяц"], ["rub_year", "₽ в год"], ["rub_m2_month", "₽/м² в месяц"], ["rub_m2_year", "₽/м² в год"]]).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
        <label>Этаж<select className="input mt-1 w-full" value={filters.floorMode} onChange={e => edit("floorMode", e.target.value as SearchFilters["floorMode"])}><option value="any">Любой</option><option value="first_floor_only">Строго первый</option><option value="exclude_basement_and_semi_basement">Без подвала и цоколя</option></select></label>
        {([['priceFrom','Цена от'],['priceTo','Цена до'],['areaFrom','Площадь от, м²'],['areaTo','Площадь до, м²']] as const).map(([key,label]) => <label key={key}>{label}<input className="input mt-1 w-full" type="number" min="0" step="0.01" value={filters[key] ?? ""} onChange={e => edit(key, e.target.value === "" ? undefined : key.startsWith("area") ? Number(e.target.value) : e.target.value as never)} /></label>)}
        <label>Районы (ИЛИ, через ;) <input className="input mt-1 w-full" value={filters.districts.join("; ")} onChange={e => edit("districts", e.target.value.split(";").map(s => s.trimStart()))} onBlur={() => edit("districts", filters.districts.map(s => s.trim()).filter(Boolean))} /></label>
        <label>Продавец<select className="input mt-1 w-full" value={filters.seller} onChange={e => edit("seller", e.target.value as SearchFilters["seller"])}><option value="all">Все</option><option value="confirmed_owner_only">Только проверенный собственник</option></select></label>
        <label>Обязательные признаки<textarea className="input mt-1 w-full" value={filters.requiredFeatures.join("; ")} onChange={e => edit("requiredFeatures", e.target.value.split(";").map(s => s.trimStart()))} onBlur={() => edit("requiredFeatures", split(filters.requiredFeatures.join(";")))} placeholder="Отдельный вход; витрина" /></label>
        <label>Желательные признаки<textarea className="input mt-1 w-full" value={filters.preferredFeatures.join("; ")} onChange={e => edit("preferredFeatures", e.target.value.split(";").map(s => s.trimStart()))} onBlur={() => edit("preferredFeatures", split(filters.preferredFeatures.join(";")))} /></label>
      </div>
      <fieldset className="mt-4"><legend className="text-sm font-medium">Назначения · ИЛИ</legend><div className="mt-2 flex flex-wrap gap-4">{PURPOSES.map(p => <label className="flex items-center gap-2" key={p}><input type="checkbox" checked={filters.purposes.includes(p)} onChange={e => edit("purposes", e.target.checked ? [...filters.purposes,p] : filters.purposes.filter(v => v !== p))} />{purposes[p]}</label>)}</div></fieldset>
      <fieldset className="mt-4"><legend className="text-sm font-medium">Площадки</legend><div className="mt-2 flex flex-wrap gap-4">{SOURCES.map(s => <label className="flex items-center gap-2" key={s}><input type="checkbox" checked={filters.sources.includes(s)} onChange={e => edit("sources", e.target.checked ? [...filters.sources,s] : filters.sources.filter(v => v !== s))} />{sourceLabels[s]}</label>)}</div></fieldset>
      <div className="mt-4 flex flex-wrap items-end gap-3"><label>Потребность (ID)<input className="input mt-1 block w-80 max-w-full" value={needId} onChange={e => { setNeedId(e.target.value); setSavedId(undefined); setDirty(true); }} placeholder="Необязательно" /></label>
        {needId && <Link className="link" href={`/needs/${needId}`}>Открыть потребность</Link>}
        {demoMode && <label>Записанный сценарий<select className="input ml-2" value={scenario} onChange={e => setScenario(e.target.value)}><option value="success">Успех</option><option value="partial">Частичный отказ</option><option value="failure">Полный отказ → веб-резерв</option><option value="empty">Исправный пустой ответ</option></select></label>}
      </div>
      {aiEnabled && <label className="mt-4 flex items-center gap-2"><input type="checkbox" checked={confirmedPaid} onChange={e => setConfirmedPaid(e.target.checked)} />Условия проверены. Разрешаю платный анализ и разрешённый веб-резерв в пределах лимитов.</label>}
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" disabled={action.pending || aiEnabled && !confirmedPaid} onClick={() => void search()}>Искать</button>
        {run && <a className="btn btn-secondary" href={`/api/v1/property-search/runs/${run.id}/export`}>Скачать CSV</a>}
        {run && manualWebAllowed && !run.webSearchUsed && <button className="btn btn-secondary" disabled={action.pending} onClick={async () => { if (!window.confirm("Запустить отдельный платный веб-поиск в пределах лимитов?")) return; const result = await action.run(() => apiCall<Run>("POST", `/api/v1/property-search/runs/${run.id}/web-search`)); if (result) setRun(result); }}>Веб-поиск</button>}
      </div>
    </Card>
    <FormErrorBanner error={action.error} />
    {action.pending && <p role="status" className="rounded border bg-blue-50 p-3">Выполняется запрос. Источники обрабатываются с ограничением времени…</p>}
    {feedback && <p role="status" className="text-sm text-emerald-700">{feedback}</p>}
    {run && <Card title="Состояние источников"><div className="flex flex-wrap gap-3">{run.sources.map(s => <div key={s.source} className="max-w-sm"><Badge tone={s.status === "success" ? "green" : s.status === "disabled" ? "gray" : "yellow"}>{sourceLabels[s.source]} · {statusLabels[s.status]} · {s.resultCount}</Badge><p className="mt-1 text-xs text-slate-500">{s.reason}</p></div>)}</div><p className="mt-3 text-sm text-slate-600">{run.fallbackReason}</p></Card>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div role="tablist" aria-label="Результаты поиска" className="flex flex-wrap gap-2">{[["confirmed","Совпадения"],["needs_review","Требуют проверки"],["rejected","Исключены"],["bookmarks","Закладки"],["saved","Мои поиски"]].map(([id,label]) => <button role="tab" aria-selected={tab === id} key={id} className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`} onClick={() => void openTab(id!)}>{label}</button>)}</div><label>Вид <select className="input" value={view} onChange={e => setView(e.target.value)}><option value="cards">Карточки</option><option value="table">Таблица</option></select></label></div>
    {tab === "saved" ? <Card title="Мои поиски"><div className="mb-4 flex flex-wrap gap-2"><input aria-label="Название поиска" className="input" value={savedName} onChange={e => { setSavedName(e.target.value); setDirty(true); }} placeholder="Название поиска" /><button className="btn btn-primary" disabled={action.pending || !savedName.trim()} onClick={async () => {
      const result = await action.run(() => apiCall<Saved>(savedId ? "PATCH" : "POST", `/api/v1/property-search/saved-searches${savedId ? `/${savedId}` : ""}`, { name: savedName, filters, sources: filters.sources, needId: needId || null, ...(savedId ? { expectedUpdatedAt: saved.find(s => s.id === savedId)?.updatedAt } : {}) }));
      if (result) { setSavedId(result.id); setDirty(false); setFeedback("Поиск сохранён"); await openTab("saved"); }
    }}>Сохранить условия</button><button className="btn btn-secondary" onClick={() => { setSavedId(undefined); setSavedName(""); }}>Новый поиск</button></div>
      {saved.length === 0 && <EmptyState title="Нет сохранённых поисков" hint="Сохраните текущие условия под понятным названием." />}
      {saved.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><span>{s.name} · {s.filters.city}</span><div className="flex gap-2"><button className="btn btn-secondary" onClick={() => { setFilters(s.filters); setSavedId(s.id); setNeedId(s.needId ?? ""); setSavedName(s.name); setConfirmedPaid(false); setDirty(false); setFeedback("Условия загружены. Проверьте и нажмите «Искать»."); }}>Открыть / запустить</button><button className="btn btn-secondary" disabled={action.pending} onClick={async () => { if (window.confirm("Удалить сохранённый поиск? История запусков сохранится.")) { await action.run(() => apiCall("DELETE", `/api/v1/property-search/saved-searches/${s.id}`)); await openTab("saved"); } }}>Удалить</button></div></div>)}
    </Card> : tab === "bookmarks" ? <div className="space-y-3">{!bookmarks.length && <EmptyState title="Закладок пока нет" hint="Сохраните интересное объявление из результатов поиска." />}{bookmarks.map(b => <Card key={b.id} title={b.listing.address ?? "Адрес не указан"}><p className="mb-3">{b.note ?? "Без заметки"}</p><div className="mb-3 flex gap-2"><select aria-label="Статус закладки" className="input" value={b.status} onChange={async e => { await listingAction(b.listing,"bookmark",{status:e.target.value,note:b.note}); await openTab("bookmarks"); }}><option value="study">Изучить</option><option value="clarify">Уточнить</option><option value="exclude">Исключить</option></select><button className="btn btn-secondary" onClick={async () => { const note = window.prompt("Заметка",b.note ?? ""); if(note !== null) {await listingAction(b.listing,"bookmark",{status:b.status,note}); await openTab("bookmarks");} }}>Заметка</button><button className="btn btn-secondary" onClick={async () => {await action.run(() => apiCall("DELETE",`/api/v1/property-search/bookmarks/${b.id}`)); await openTab("bookmarks");}}>Удалить закладку</button><a className="link" href={b.listing.url} target="_blank" rel="noopener noreferrer">Источник ↗</a></div><ResultActions listing={b.listing} /></Card>)}</div> : <>
      {!rows.length && <EmptyState title={run ? "В этой вкладке нет объявлений" : "Задайте условия и запустите поиск"} hint={run ? "Проверьте вкладку «Требуют проверки» и состояние источников." : "Результаты будут проверены по каждому условию на сервере."} />}
      {view === "table" && rows.length > 0 && <div className="overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Источник / адрес","Цена","Площадь","Этаж","Действия"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr className="border-t" key={r.id}><td className="p-3"><a className="link" href={r.listing.url} target="_blank" rel="noopener noreferrer">{sourceLabels[r.listing.source]} ↗</a><p>{r.snapshot?.address ?? r.listing.address ?? "Адрес неизвестен"}</p></td><td className="p-3">{numberText(r.snapshot?.price)} ₽</td><td className="p-3">{numberText(r.snapshot?.area)} м²</td><td className="p-3">{r.snapshot?.floor?.raw ?? "—"}</td><td className="p-3"><details><summary>Доказательства и действия</summary><Evidence criteria={r.criteria} /><ResultActions listing={r.listing} /></details></td></tr>)}</tbody></table></div>}
      {view === "cards" && <div className="grid gap-4 xl:grid-cols-2">{rows.map(r => <Card key={r.id} title={r.snapshot?.address ?? r.listing.address ?? "Адрес требует проверки"}>
        <div className="mb-3 flex flex-wrap items-center gap-2"><a className="link" href={r.snapshot?.url ?? r.listing.url} target="_blank" rel="noopener noreferrer">{sourceLabels[r.listing.source]} ↗</a><Badge>{r.listing.sourceMethod === "web_search" ? "web_search · требуется проверка" : "Площадка"}</Badge>{r.isNew && <Badge tone="blue">Новое</Badge>}{r.priceChanged && <Badge tone="yellow">Цена изменилась</Badge>}</div>
        <div className="mb-3 flex flex-wrap gap-6 text-lg font-semibold"><span>{numberText(r.snapshot?.price)} ₽ <small className="text-xs font-normal">{r.snapshot?.priceUnit ?? "единица неизвестна"}</small></span><span>{numberText(r.snapshot?.area)} м²</span><span>Этаж: {r.snapshot?.floor?.raw ?? "—"}</span></div>
        <p className="text-xs text-slate-500">Получено: {new Date(r.snapshot?.fetchedAt ?? r.listing.lastSeenAt).toLocaleString("ru-RU",{timeZone:"Asia/Novosibirsk"})}</p>
        <Evidence criteria={r.criteria} />
        {r.listing.verifications?.map(v => <div key={v.verifiedAt} className="mb-3 rounded bg-slate-50 p-2 text-xs">Проверка сотрудника {v.verifiedBy}: {v.availability} · собственник: {v.ownerConfirmed === null ? "неизвестно" : v.ownerConfirmed ? "подтверждён" : "не подтверждён"} · {new Date(v.verifiedAt).toLocaleString("ru-RU")}<br />Следующая проверка: {v.nextCheckAt ? new Date(v.nextCheckAt).toLocaleString("ru-RU") : "не назначена"}</div>)}
        <ResultActions listing={r.listing} />
      </Card>)}</div>}
    </>}
  </div>;
}
function Evidence({ criteria }: { criteria: CriterionEvaluation[] }) {
  return <details className="my-3"><summary className="cursor-pointer text-sm font-medium">Доказательства по критериям ({criteria.length})</summary><ul className="mt-2 space-y-2">{criteria.map((c,index) => <li key={index} className="rounded border p-2 text-sm"><Badge tone={c.state === "matched" ? "green" : c.state === "contradicted" ? "red" : "yellow"}>{c.state}</Badge> <strong>{c.criterion}</strong> · {c.source}<p className="mt-1 text-slate-600">{c.evidence || "Нет сведений"}</p></li>)}</ul></details>;
}
