"use client";

import { displayLabel, labelOf, DISPLAY_LABELS } from "@/shared/codebook";
import { ListingPhoto } from "./listing-photo";
import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/ui/client-kit";
import { CheckCircle2, AlertTriangle, CircleOff, Clock3 } from "lucide-react";
import { ListingDialog, type ListingDialogKind } from "./listing-dialog";
import { DistrictPicker, SearchPicker, SearchProgress, type ClientChoice, type NeedChoice } from "./search-controls";
import { Badge, Card, EmptyState } from "@/ui/components";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { SearchFilters, SOURCES, PURPOSES, type NormalizedListing, type CriterionEvaluation } from "@/modules/property-search/domain/types";

type Listing = { id: string; source: string; sourceMethod: string; url: string; address: string | null; priceRub: string | null; areaM2: string | null;
  floorRaw: string | null; lastSeenAt: string; propertyId: string | null; description?: string | null;
  verifications?: { availability: string; ownerConfirmed: boolean | null; priceConfirmed: boolean | null; verifiedAt: string; verifiedBy: string; nextCheckAt: string | null }[] };
type Result = { id: string; listingId: string; listing: Listing; verdict: string; criteria: CriterionEvaluation[]; isNew: boolean; priceChanged: boolean; snapshot?: NormalizedListing | null };
type Run = { startedAt?: string; finishedAt?: string | null; id: string; status: string; fallbackReason: string | null; webSearchUsed: boolean; sources: { source: string; status: string; reason: string | null; resultCount: number; durationMs?: number | null }[]; results: Result[] };
type Bookmark = { id: string; status: string; note: string | null; listing: Listing };
type Saved = { id: string; name: string; needId: string | null; sources: string[]; filters: SearchFilters; updatedAt: string };
const purposes = { retail: "Торговля", psn_universal: "ПСН / универсальное", office: "Офис", production: "Производство", warehouse: "Склад", free_purpose: "Свободное назначение" };
const sourceLabels: Record<string, string> = { cian: "Циан", mirkvartir: "Мир Квартир", onrealt: "OnRealt", domclick: "Домклик", yandex: "Яндекс Недвижимость", youla: "Юла", avito: "Авито", web_search: "Веб-резерв" };
const statusLabels: Record<string, string> = { success: "Успешно", partial: "Частично", blocked: "Заблокирован", timeout: "Тайм-аут", unsupported_filter: "Фильтр не поддержан", error: "Ошибка", disabled: "Отключён" };
const split = (text: string) => text.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
const numberText = (v: string | number | null | undefined) => v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU");

export function SearchWorkspace({ initialFilters, initialRun, initialNeedId, initialNeed, demoMode, aiEnabled, manualWebAllowed }: {
  initialFilters: SearchFilters; initialRun?: Run; initialNeedId?: string; initialNeed?: NeedChoice; demoMode: boolean; aiEnabled: boolean; manualWebAllowed: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [needId, setNeedId] = useState(initialNeedId ?? "");
  const [client, setClient] = useState<ClientChoice | null>(initialNeed?.client ?? null);
  const [need, setNeed] = useState<NeedChoice | null>(initialNeed ?? null);
  const [phase, setPhase] = useState<"parse" | "search" | "web" | null>(null);
  const [dialog, setDialog] = useState<{ listing: Listing; kind: ListingDialogKind; note?: string; extra?: Record<string, unknown> } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Result[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paid, setPaid] = useState<"search" | "web" | null>(null);
  const [limits, setLimits] = useState<{ modes: { ai: boolean; manualWeb: boolean }; remaining: { hour: number; day: number; webJobsToday: number; monthlyBudgetRub?: string }; budgetAvailable: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [clarification, setClarification] = useState("");
  const [run, setRun] = useState<Run | null>(initialRun ?? null);
  const [tab, setTab] = useState("confirmed");
  const [view, setView] = useState("cards");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [savedName, setSavedName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [scenario, setScenario] = useState("success");
  const action = useApiAction();
  useUnsavedChangesWarning(dirty);
  function edit<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) { setFilters(current => ({ ...current, [key]: value })); setDirty(true); }
  async function search(confirmedPaid = false, nextFilters = filters, nextSavedId = savedId, nextNeedId = needId) {
    setPhase("search");
    const result = await action.run(async () => {
      const checked = SearchFilters.safeParse(nextFilters);
      if (!checked.success) throw new ApiCallError(400, { code: "VALIDATION_ERROR", message: checked.error.issues.map(i => i.message).join("; "),
        fieldErrors: Object.fromEntries(checked.error.issues.map(i => [i.path.join("."), [i.message]])) });
      return apiCall<Run>("POST", "/api/v1/property-search/runs", { filters: checked.data, sources: checked.data.sources, needId: nextNeedId || undefined, savedSearchId: nextSavedId, confirmedPaid, demoScenario: scenario });
    });
    setPhase(null);
    if (result) { setComparison([]); setRun(result); setDirty(false); setFeedback("Поиск завершён"); setTab("confirmed");
      const url = new URL(window.location.href); url.searchParams.set("runId", result.id); window.history.replaceState(null, "", url); }
  }
  async function openTab(value: string) {
    setTab(value);
    if (value === "bookmarks") { const rows = await action.run(() => apiCall<Bookmark[]>("GET", "/api/v1/property-search/bookmarks")); if (rows) setBookmarks(rows); }
    if (value === "saved") { const rows = await action.run(() => apiCall<Saved[]>("GET", "/api/v1/property-search/saved-searches")); if (rows) setSaved(rows); }
  }
  async function listingAction(listing: Listing, name: string, extra: Record<string, unknown> = {}) {
    const result = await apiCall<{ id?: string }>("POST", `/api/v1/property-search/listings/${listing.id}/${name}`, extra);
    setFeedback(name === "transfer" ? "Объект сохранён в каталоге CRM" : name === "offer" ? "Объект добавлен в черновик КП" : "Изменения сохранены");
    if (run) { const updated = await apiCall<Run>("GET", `/api/v1/property-search/runs/${run.id}`); setRun(updated); }
    if (tab === "bookmarks") { const rows = await apiCall<Bookmark[]>("GET", "/api/v1/property-search/bookmarks"); setBookmarks(rows); }
    return result;
  }
  async function selectNeed(value: NeedChoice | null) {
    setNeed(value); setNeedId(value?.id ?? ""); setSavedId(undefined); setDirty(true);
    if (!value) return;
    setClient(value.client);
    const result = await action.run(() => apiCall<{ filters: SearchFilters }>("GET", `/api/v1/property-search/pick-needs?needId=${value.id}`));
    if (result) { setFilters(result.filters); setFeedback("Условия заполнены из потребности. Проверьте их перед поиском."); }
  }
  async function confirmPaid(kind: "search" | "web") {
    setLimits(null); setPaid(kind);
    const result = await action.run(() => apiCall<NonNullable<typeof limits>>("GET", "/api/v1/ai/limits"));
    if (result) setLimits(result);
  }
  function toggleCompare(row: Result) {
    setComparison(current => current.some(r => r.listingId === row.listingId) ? current.filter(r => r.listingId !== row.listingId) : current.length < 4 ? [...current, row] : current);
  }
  function ResultActions({ listing }: { listing: Listing }) {
    const button = (kind: ListingDialogKind, label: string, disabled = false) => <button type="button" className="btn btn-secondary" disabled={action.pending || disabled} onClick={() => setDialog({ listing, kind })}>{label}</button>;
    return <div className="flex flex-wrap items-start gap-2">
      {button("bookmark", "В закладки")}{button("selection", "В подборку клиента", !needId)}
      <details className="relative"><summary className="btn btn-secondary cursor-pointer">Ещё</summary><div className="mt-2 flex flex-wrap gap-2 rounded border bg-slate-50 p-2">
        {button("clarify", "Уточнить")}
        {listing.propertyId ? <Link className="btn btn-secondary" href={`/properties/${listing.propertyId}`}>Открыть объект CRM</Link> : button("transfer", "В каталог CRM")}
        {button("propose", "Предложить клиенту", !needId)}{button("offer", "В КП", !needId)}{button("verification", "Проверка сотрудника")}
      </div></details>
      {!needId && <span className="basis-full text-xs text-slate-500">Для подборки и КП выберите потребность выше.</span>}
    </div>;
  }
  const rows = (run?.results ?? []).filter(r => r.verdict === tab);
  return <div className="min-w-0 space-y-4">
    {demoMode && <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">Режим тестирования: записанные ответы площадок</div>}
    <Card title="Условия поиска">
      <label className="block font-medium" htmlFor="query">Опишите объект на русском</label>
      <textarea id="query" className="input mt-2 w-full" rows={2} value={query} onChange={e => { setQuery(e.target.value); setDirty(true); }} placeholder="Торговое помещение на первом этаже, отдельный вход, до 150 м²…" />
      <div className="my-3 flex flex-wrap items-center gap-3"><button className="btn btn-secondary" disabled={action.pending || !aiEnabled || !query.trim()} onClick={async () => {
        setPhase("parse");
        const parsed = await action.run(() => apiCall<{ filters: SearchFilters | null; clarificationQuestion: string | null }>("POST", "/api/v1/property-search/parse", { text: query, currentFilters: filters }));
        setPhase(null);
        if (parsed) { setClarification(parsed.clarificationQuestion ?? ""); if (parsed.filters) { setFilters(parsed.filters); setDirty(true); setFeedback("Проверьте распознанные условия перед запуском"); } }
      }}>Разобрать с ИИ</button><span className="text-sm text-slate-500">{aiEnabled ? "Разбор и анализ используют настроенные лимиты ИИ" : "ИИ отключён · ручные фильтры доступны"}</span></div>
      {clarification && <p role="status" className="mb-3 rounded bg-amber-50 p-3">Уточнение: {clarification}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label>Город<input className="input mt-1 w-full" value={filters.city} onChange={e => { setFilters(f => ({ ...f, city: e.target.value, districts: [] })); setDirty(true); }} /></label>
        <label>Операция<select className="input mt-1 w-full" value={filters.operation} onChange={e => { const op = e.target.value as "sale" | "rent"; setFilters(f => ({ ...f, operation: op, priceUnit: op === "sale" ? "rub_total" : "rub_month" })); setDirty(true); }}><option value="sale">Продажа</option><option value="rent">Аренда</option></select></label>
        <label>Единица цены<select className="input mt-1 w-full" value={filters.priceUnit ?? "rub_total"} onChange={e => edit("priceUnit", e.target.value as SearchFilters["priceUnit"])}>
          {(filters.operation === "sale" ? [["rub_total", "₽ за объект"]] : [["rub_month", "₽ в месяц"], ["rub_year", "₽ в год"], ["rub_m2_month", "₽/м² в месяц"], ["rub_m2_year", "₽/м² в год"]]).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
        <label>Этаж<select className="input mt-1 w-full" value={filters.floorMode} onChange={e => edit("floorMode", e.target.value as SearchFilters["floorMode"])}><option value="any">Любой</option><option value="first_floor_only">Строго первый</option><option value="exclude_basement_and_semi_basement">Без подвала и цоколя</option></select></label>
        {([['priceFrom','Цена от'],['priceTo','Цена до'],['areaFrom','Площадь от, м²'],['areaTo','Площадь до, м²']] as const).map(([key,label]) => <label key={key}>{label}<input className="input mt-1 w-full" type="number" min="0" step="0.01" value={filters[key] ?? ""} onChange={e => edit(key, e.target.value === "" ? undefined : key.startsWith("area") ? Number(e.target.value) : e.target.value as never)} /></label>)}
        <DistrictPicker city={filters.city} value={filters.districts} onChange={value => edit("districts", value)} />
        <label>Продавец<select className="input mt-1 w-full" value={filters.seller} onChange={e => edit("seller", e.target.value as SearchFilters["seller"])}><option value="all">Все</option><option value="confirmed_owner_only">Только проверенный собственник</option></select></label>
        <label>Обязательные признаки<textarea className="input mt-1 w-full" value={filters.requiredFeatures.join("; ")} onChange={e => edit("requiredFeatures", e.target.value.split(";").map(s => s.trimStart()))} onBlur={() => edit("requiredFeatures", split(filters.requiredFeatures.join(";")))} placeholder="Отдельный вход; витрина" /></label>
        <label>Желательные признаки<textarea className="input mt-1 w-full" value={filters.preferredFeatures.join("; ")} onChange={e => edit("preferredFeatures", e.target.value.split(";").map(s => s.trimStart()))} onBlur={() => edit("preferredFeatures", split(filters.preferredFeatures.join(";")))} /></label>
      </div>
      <fieldset className="mt-4"><legend className="text-sm font-medium">Назначения · ИЛИ</legend><div className="mt-2 flex flex-wrap gap-4">{PURPOSES.map(p => <label className="flex items-center gap-2" key={p}><input type="checkbox" checked={filters.purposes.includes(p)} onChange={e => edit("purposes", e.target.checked ? [...filters.purposes,p] : filters.purposes.filter(v => v !== p))} />{purposes[p]}</label>)}</div></fieldset>
      <fieldset className="mt-4"><legend className="text-sm font-medium">Площадки</legend><div className="mt-2 flex flex-wrap gap-4">{SOURCES.map(s => <label className="flex items-center gap-2" key={s}><input type="checkbox" checked={filters.sources.includes(s)} onChange={e => edit("sources", e.target.checked ? [...filters.sources,s] : filters.sources.filter(v => v !== s))} />{sourceLabels[s]}</label>)}</div></fieldset>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SearchPicker<ClientChoice> label="Клиент (необязательно)" url="/api/v1/clients/pick" value={client} render={c => c.displayName} onChange={value => { setClient(value); setNeed(null); setNeedId(""); setSavedId(undefined); setDirty(true); }} />
        <SearchPicker<NeedChoice> label="Потребность (необязательно)" url={`/api/v1/property-search/pick-needs${client ? `?clientId=${client.id}` : ""}`} value={need} render={n => `${n.client?.displayName ?? "Клиент недоступен"} · ${n.label}`} onChange={value => void selectNeed(value)} />
        {needId && <Link className="link" href={`/needs/${needId}`}>Открыть потребность</Link>}
        {demoMode && <label>Записанный сценарий<select className="input ml-2" value={scenario} onChange={e => setScenario(e.target.value)}><option value="success">Успех</option><option value="partial">Частичный отказ</option><option value="failure">Полный отказ → веб-резерв</option><option value="empty">Исправный пустой ответ</option></select></label>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" disabled={action.pending} onClick={() => aiEnabled ? void confirmPaid("search") : void search()}>Искать</button>
        {run && <a className="btn btn-secondary" href={`/api/v1/property-search/runs/${run.id}/export`}>Скачать CSV</a>}
        {run && manualWebAllowed && !run.webSearchUsed && <button className="btn btn-secondary" disabled={action.pending} onClick={() => void confirmPaid("web")}>Веб-поиск</button>}
      </div>
    </Card>
    <FormErrorBanner error={action.error} />
    <SearchProgress phase={phase} completed={!!run} />
    {action.pending && !phase && <p role="status" className="text-sm text-slate-500">Загрузка…</p>}
    {feedback && <p role="status" className="text-sm text-emerald-700">{feedback}</p>}
    {run && <Card title="Состояние источников"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{run.sources.map(s => {
      const Icon = s.status === "success" ? CheckCircle2 : s.status === "disabled" ? CircleOff : s.status === "timeout" ? Clock3 : AlertTriangle;
      return <div key={s.source} className="min-w-0 rounded border p-3"><div className="flex items-center gap-2"><Icon aria-hidden size={18} className={s.status === "success" ? "text-emerald-600" : "text-amber-600"} /><strong className="text-sm">{sourceLabels[s.source] ?? s.source}</strong></div>
        <div className="my-2 flex flex-wrap items-center gap-2"><Badge tone={s.status === "success" ? "green" : s.status === "disabled" ? "gray" : "yellow"}>{statusLabels[s.status] ?? s.status}</Badge><span className="text-sm">Объявлений: {s.resultCount}</span></div>
        <p className="break-words text-xs text-slate-600">{s.reason || (s.status === "success" ? "Источник обработан" : "Причина не указана источником")}</p>
        <p className="mt-2 text-xs text-slate-500">{s.durationMs != null && <>Время источника: {numberText(s.durationMs / 1000)} с · </>}Завершение запуска: {run.finishedAt ? new Date(run.finishedAt).toLocaleString("ru-RU", {timeZone:"Asia/Novosibirsk"}) : "—"}</p></div>;
    })}</div><p className="mt-3 text-sm text-slate-600">{run.fallbackReason}</p></Card>}
    {comparison.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded border bg-white p-3"><span className="text-sm">Выбрано для сравнения: {comparison.length} / 4</span><button className="btn btn-primary" disabled={comparison.length < 2} onClick={() => setCompareOpen(true)}>Сравнить</button><button className="btn btn-secondary" onClick={() => setComparison([])}>Сбросить</button></div>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div role="tablist" aria-label="Результаты поиска" className="flex flex-wrap gap-2">{[["confirmed","Совпадения"],["needs_review","Требуют проверки"],["rejected","Исключены"],["bookmarks","Закладки"],["saved","Мои поиски"]].map(([id,label]) => <button role="tab" aria-selected={tab === id} key={id} className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`} onClick={() => void openTab(id!)}>{label}</button>)}</div><label>Вид <select className="input" value={view} onChange={e => setView(e.target.value)}><option value="cards">Карточки</option><option value="table">Таблица</option></select></label></div>
    {tab === "saved" ? <Card title="Мои поиски"><div className="mb-4 flex flex-wrap gap-2"><input aria-label="Название поиска" className="input" value={savedName} onChange={e => { setSavedName(e.target.value); setDirty(true); }} placeholder="Название поиска" /><button className="btn btn-primary" disabled={action.pending || !savedName.trim()} onClick={async () => {
      const result = await action.run(() => apiCall<Saved>(savedId ? "PATCH" : "POST", `/api/v1/property-search/saved-searches${savedId ? `/${savedId}` : ""}`, { name: savedName, filters, sources: filters.sources, needId: needId || null, ...(savedId ? { expectedUpdatedAt: saved.find(s => s.id === savedId)?.updatedAt } : {}) }));
      if (result) { setSavedId(result.id); setDirty(false); setFeedback("Поиск сохранён"); await openTab("saved"); }
    }}>Сохранить условия</button><button className="btn btn-secondary" onClick={() => { setSavedId(undefined); setSavedName(""); }}>Новый поиск</button></div>
      {saved.length === 0 && <EmptyState title="Нет сохранённых поисков" hint="Сохраните текущие условия под понятным названием." />}
      {saved.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><span>{s.name} · {s.filters.city}</span><div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => { setFilters(s.filters); setSavedId(s.id); setNeedId(s.needId ?? ""); setNeed(null); setClient(null); if (s.needId) { void action.run(async () => { const picked = await apiCall<{items: NeedChoice[]}>("GET", `/api/v1/property-search/pick-needs?needId=${s.needId}`); setNeed(picked.items[0] ?? null); setClient(picked.items[0]?.client ?? null); return picked; }); } setSavedName(s.name); setDirty(false); setFeedback("Условия загружены. Проверьте и нажмите «Искать»."); }}>Открыть / запустить</button><button className="btn btn-secondary" disabled={action.pending} onClick={() => setDeleteId(s.id)}>Удалить</button></div></div>)}
    </Card> : tab === "bookmarks" ? <div className="space-y-3">{!bookmarks.length && <EmptyState title="Закладок пока нет" hint="Сохраните интересное объявление из результатов поиска." />}{bookmarks.map(b => <Card key={b.id} title={b.listing.address ?? "Адрес не указан"}><p className="mb-3">{b.note ?? "Без заметки"}</p><div className="mb-3 flex flex-wrap gap-2"><select aria-label="Статус закладки" className="input" value={b.status} onChange={async e => { await action.run(() => listingAction(b.listing,"bookmark",{status:e.target.value,note:b.note})); await openTab("bookmarks"); }}><option value="study">Изучить</option><option value="clarify">Уточнить</option><option value="exclude">Исключить</option></select><button className="btn btn-secondary" onClick={() => setDialog({listing: b.listing, kind: "bookmark", note: b.note ?? "", extra: {status:b.status}})}>Заметка</button><button className="btn btn-secondary" onClick={async () => {await action.run(() => apiCall("DELETE",`/api/v1/property-search/bookmarks/${b.id}`)); await openTab("bookmarks");}}>Удалить закладку</button><a className="link" href={b.listing.url} target="_blank" rel="noopener noreferrer">Источник ↗</a></div><ResultActions listing={b.listing} /></Card>)}</div> : <>
      {!rows.length && <EmptyState title={run ? "В этой вкладке нет объявлений" : "Задайте условия и запустите поиск"} hint={run ? "Проверьте вкладку «Требуют проверки» и состояние источников." : "Результаты будут проверены по каждому условию на сервере."} />}
      {view === "table" && rows.length > 0 && <div className="overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Источник / адрес","Цена","Площадь","Этаж","Действия"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr className="border-t" key={r.id}><td className="p-3"><label className="mb-2 flex items-center gap-2"><input type="checkbox" checked={comparison.some(c => c.listingId === r.listingId)} disabled={comparison.length >= 4 && !comparison.some(c => c.listingId === r.listingId)} onChange={() => toggleCompare(r)} />Сравнить</label><a className="link" href={r.listing.url} target="_blank" rel="noopener noreferrer">{labelOf("externalSource", r.listing.source)} ↗</a><p>{r.snapshot?.address ?? r.listing.address ?? "Адрес неизвестен"}</p></td><td className="p-3">{numberText(r.snapshot?.price)} ₽</td><td className="p-3">{numberText(r.snapshot?.area)} м²</td><td className="p-3">{r.snapshot?.floor?.raw ?? "—"}</td><td className="p-3"><details><summary>Доказательства и действия</summary><Evidence criteria={r.criteria} /><ResultActions listing={r.listing} /></details></td></tr>)}</tbody></table></div>}
      {view === "cards" && <div className="grid gap-4 xl:grid-cols-2">{rows.map(r => <Card key={r.id} title={r.snapshot?.address ?? r.listing.address ?? "Адрес требует проверки"}>
        <div className="mb-3 flex flex-wrap items-center gap-2"><a className="link" href={r.snapshot?.url ?? r.listing.url} target="_blank" rel="noopener noreferrer">{labelOf("externalSource", r.listing.source)} ↗</a><Badge>{r.listing.sourceMethod === "web_search" ? "Веб-поиск · требуется проверка" : "Площадка"}</Badge>{r.isNew && <Badge tone="blue">Новое</Badge>}{r.priceChanged && <Badge tone="yellow">Цена изменилась</Badge>}</div>
        <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={comparison.some(c => c.listingId === r.listingId)} disabled={comparison.length >= 4 && !comparison.some(c => c.listingId === r.listingId)} onChange={() => toggleCompare(r)} />Сравнить объявление</label>
        <ListingPhoto propertyId={r.listing.propertyId} sourceUrl={r.listing.url} />
        <div className="mb-3 flex flex-wrap gap-6 text-lg font-semibold"><span>{numberText(r.snapshot?.price)} ₽ <small className="text-xs font-normal">{r.snapshot?.priceUnit ? displayLabel("price_unit", r.snapshot.priceUnit) : "единица неизвестна"}</small></span><span>{numberText(r.snapshot?.area)} м²</span><span>Этаж: {r.snapshot?.floor?.raw ?? "—"}</span></div>
        <p className="text-xs text-slate-500">Получено: {new Date(r.snapshot?.fetchedAt ?? r.listing.lastSeenAt).toLocaleString("ru-RU",{timeZone:"Asia/Novosibirsk"})}</p>
        <Evidence criteria={r.criteria} />
        {r.listing.verifications?.map(v => <div key={v.verifiedAt} className="mb-3 rounded bg-slate-50 p-2 text-xs">Проверка сотрудника {v.verifiedBy}: {labelOf("listingAvailability", v.availability)} · собственник: {v.ownerConfirmed === null ? "неизвестно" : v.ownerConfirmed ? "подтверждён" : "не подтверждён"} · {new Date(v.verifiedAt).toLocaleString("ru-RU")}<br />Следующая проверка: {v.nextCheckAt ? new Date(v.nextCheckAt).toLocaleString("ru-RU") : "не назначена"}</div>)}
        <ResultActions listing={r.listing} />
      </Card>)}</div>}
    </>}
    {dialog && <ListingDialog key={`${dialog.listing.id}-${dialog.kind}`} kind={dialog.kind} address={dialog.listing.address} url={dialog.listing.url} initialNote={dialog.note} needsTransfer={["offer", "propose"].includes(dialog.kind) && !dialog.listing.propertyId} onClose={() => setDialog(null)} onSubmit={async body => {
      if (["offer", "propose"].includes(dialog.kind) && !dialog.listing.propertyId) await listingAction(dialog.listing, "transfer", { confirmed: true, identityConfirmed: body.identityConfirmed, address: body.address, operation: filters.operation });
      return listingAction(dialog.listing, dialog.kind, { ...body, ...dialog.extra, ...(needId ? {needId} : {}), ...(dialog.kind === "transfer" ? {operation:filters.operation} : {}) });
    }} />}
    {deleteId && <ListingDialog kind="delete" onClose={() => setDeleteId(null)} onSubmit={async () => { const result = await apiCall("DELETE", `/api/v1/property-search/saved-searches/${deleteId}`); await openTab("saved"); return result; }} />}
    <Modal open={compareOpen} wide title="Сравнение объявлений" onClose={() => setCompareOpen(false)}><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><caption className="mb-3 text-left text-slate-500">Сравниваются 2–4 объявления. Неизвестные сведения отмечены «—».</caption><thead><tr><th className="p-2">Характеристика</th>{comparison.map(r => <th className="max-w-64 p-2" key={r.id}><a className="link" href={r.listing.url} target="_blank" rel="noopener noreferrer">{r.snapshot?.address ?? r.listing.address ?? "Адрес неизвестен"} ↗</a></th>)}</tr></thead><tbody>
      {([ ["Источник", (r: Result) => sourceLabels[r.listing.source]], ["Цена", (r: Result) => `${numberText(r.snapshot?.price ?? r.listing.priceRub)} ₽ · ${r.snapshot?.priceUnit ? displayLabel("price_unit", r.snapshot.priceUnit) : "единица неизвестна"}`], ["Площадь", (r: Result) => `${numberText(r.snapshot?.area ?? r.listing.areaM2)} м²`], ["Этаж", (r: Result) => r.snapshot?.floor?.raw ?? r.listing.floorRaw ?? "—"], ["Район", (r: Result) => r.snapshot?.district ?? "—"], ["Проверка", (r: Result) => r.verdict === "confirmed" ? "Совпадение" : r.verdict === "rejected" ? "Исключено" : "Требует проверки"] ] as const).map(([label, render]) => <tr className="border-t" key={label}><th className="p-2">{label}</th>{comparison.map(r => <td className="p-2 align-top" key={r.id}>{render(r)}</td>)}</tr>)}
      <tr className="border-t"><th className="p-2">Доказательства</th>{comparison.map(r => <td className="p-2 align-top" key={r.id}><Evidence criteria={r.criteria} /></td>)}</tr>
    </tbody></table></div></Modal>
    <Modal open={!!paid} title="Подтверждение платного поиска" onClose={() => { if (!action.pending) setPaid(null); }}><div className="space-y-4"><p>Проверьте условия. Анализ объявлений{paid === "web" ? " и отдельный веб-поиск" : " и разрешённый веб-резерв"} используют лимиты ИИ.</p>
      {limits ? <dl className="grid grid-cols-2 gap-2 rounded border p-3 text-sm"><dt>Запросов в час</dt><dd>{limits.remaining.hour}</dd><dt>Запросов сегодня</dt><dd>{limits.remaining.day}</dd><dt>Веб-поисков сегодня</dt><dd>{limits.remaining.webJobsToday}</dd><dt>Остаток бюджета месяца</dt><dd>{limits.remaining.monthlyBudgetRub !== undefined ? `${numberText(limits.remaining.monthlyBudgetRub)} ₽` : limits.budgetAvailable ? "Доступен" : "Исчерпан"}</dd></dl> : <p role="status">{action.pending ? "Проверяем доступный лимит…" : "Не удалось получить лимиты. Закройте окно и повторите."}</p>}
      <FormErrorBanner error={action.error} /><div className="flex flex-wrap justify-end gap-2"><button className="btn btn-secondary" disabled={action.pending} onClick={() => setPaid(null)}>Отмена</button><button className="btn btn-primary" disabled={action.pending || !limits || !limits.modes.ai || !limits.budgetAvailable || !limits.remaining.hour || !limits.remaining.day || paid === "web" && (!limits.modes.manualWeb || !limits.remaining.webJobsToday)} onClick={async () => { const kind = paid; setPaid(null); if (kind === "search") await search(true); else if (run) { setPhase("web"); const result = await action.run(() => apiCall<Run>("POST", `/api/v1/property-search/runs/${run.id}/web-search`)); setPhase(null); if (result) setRun(result); } }}>Подтверждаю запуск</button></div>
    </div></Modal>
  </div>;
}
function Evidence({ criteria }: { criteria: CriterionEvaluation[] }) {
  return <details className="my-3"><summary className="cursor-pointer text-sm font-medium">Доказательства по критериям ({criteria.length})</summary><ul className="mt-2 space-y-2">{criteria.map((c,index) => <li key={index} className="rounded border p-2 text-sm"><Badge tone={c.state === "matched" ? "green" : c.state === "contradicted" ? "red" : "yellow"}>{displayLabel("criterion_state", c.state)}</Badge> <strong>{displayLabel("criterion", c.criterion)}</strong> · {displayLabel("criterion_source", c.source)}<p className="mt-1 text-slate-600">{evidenceText(c)}</p></li>)}</ul></details>;
}

function evidenceText(c: CriterionEvaluation): string {
  let text = c.evidence || "Нет сведений";
  const group = c.criterion === "operation" ? "property_operation_type" : c.criterion === "purpose" ? "property_type" : "price_unit";
  for (const [code, label] of Object.entries(DISPLAY_LABELS[group] ?? {})) text = text.replace(new RegExp(`\\b${code}\\b`, "g"), label);
  return text;
}
