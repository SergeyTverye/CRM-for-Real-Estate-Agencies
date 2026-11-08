"use client";
import { resultAddress, resultTitle, resultPriceUnit, evidenceLabel, translatedEvidence } from "./result-display";
import { CatalogPhoto } from "./catalog-photo";

import { useEffect, useRef, useState } from "react";
import { SearchResultsV31 } from "./search-results-v31";
import { CatalogFilters } from "./catalog-filters";
import { QueryRefinement } from "@/ui/listing-analysis/query-refinement";
import Link from "next/link";
import { Modal } from "@/ui/client-kit";
import { ListingDialog, type ListingDialogKind } from "./listing-dialog";
import { DistrictPicker, SearchPicker, SearchProgress, type ClientChoice, type NeedChoice } from "./search-controls";
import { Badge, Card, EmptyState } from "@/ui/components";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { SearchFilters, SOURCES, PURPOSES, type NormalizedListing, type CriterionEvaluation } from "@/modules/property-search/domain/types";
import {
  countActiveAdvancedFilters,
  DEFAULT_DEADLINE_SECONDS,
  DEFAULT_SEARCH_DEPTH,
  describeAiAvailability,
  describeAvailabilityReason,
  PURPOSE_HELP,
  PURPOSE_LABELS,
  resetAdvancedSearchFilters,
  SEARCH_HELP,
  SOURCE_LABELS,
  summarizeActiveAdvancedFilters,
  type SearchRuntimeAvailability,
} from "./filter-presentation";
import { HelpTooltip } from "./help-tooltip";

type Listing = {
  id: string;
  source: string;
  sourceMethod: string;
  url: string;
  address: string | null;
  priceRub: string | null;
  areaM2: string | null;
  operation?: string;
  priceUnit?: string;
  title?: string | null;
  floorRaw: string | null;
  lastSeenAt: string;
  propertyId: string | null;
  description?: string | null;
  verifications?: {
    availability: string;
    ownerConfirmed: boolean | null;
    priceConfirmed: boolean | null;
    verifiedAt: string;
    verifiedBy: string;
    nextCheckAt: string | null;
  }[];
};
type Result = {
  id: string;
  listingId: string;
  listing: Listing;
  verdict: string;
  criteria: CriterionEvaluation[];
  isNew: boolean;
  priceChanged: boolean;
  snapshot?: NormalizedListing | null;
};
type Run = {
  filters?: { operation: "sale" | "rent" };
  startedAt?: string;
  finishedAt?: string | null;
  id: string;
  status: string;
  fallbackReason: string | null;
  webSearchUsed: boolean;
  sources: { source: string; status: string; reason: string | null; resultCount: number; durationMs?: number | null }[];
  results: Result[];
};
type Bookmark = { id: string; status: string; note: string | null; listing: Listing };
type Saved = { id: string; name: string; needId: string | null; sources: string[]; filters: SearchFilters; updatedAt: string };

const split = (text: string) =>
  text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const numberText = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU");

export function SearchWorkspace({
  initialFilters,
  initialRun,
  initialNeedId,
  initialNeed,
  demoMode,
  aiEnabled,
  manualWebAllowed,
  initialAvailability,
  isManager = false,
  defaultAdvancedOpen = false,
}: {
  initialFilters: SearchFilters;
  initialRun?: Run;
  initialNeedId?: string;
  initialNeed?: NeedChoice;
  demoMode: boolean;
  aiEnabled: boolean;
  manualWebAllowed: boolean;
  initialAvailability?: SearchRuntimeAvailability;
  isManager?: boolean;
  defaultAdvancedOpen?: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);
  const [availability, setAvailability] = useState<SearchRuntimeAvailability | undefined>(initialAvailability);
  const [needId, setNeedId] = useState(initialNeedId ?? "");
  const [client, setClient] = useState<ClientChoice | null>(initialNeed?.client ?? null);
  const [need, setNeed] = useState<NeedChoice | null>(initialNeed ?? null);
  const [phase, setPhase] = useState<"parse" | "search" | "web" | null>(null);
  const [dialog, setDialog] = useState<{
    listing: Listing;
    kind: ListingDialogKind;
    note?: string;
    extra?: Record<string, unknown>;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Result[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paid, setPaid] = useState<"search" | "web" | null>(null);
  const [limits, setLimits] = useState<{
    modes: { ai: boolean; manualWeb: boolean };
    remaining: { hour: number; day: number; webJobsToday: number; monthlyBudgetRub?: string };
    budgetAvailable: boolean;
  } | null>(null);
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
  const [depth, setDepth] = useState(DEFAULT_SEARCH_DEPTH);
  const [deadlineSeconds, setDeadlineSeconds] = useState(DEFAULT_DEADLINE_SECONDS);
  const [resultRefresh, setResultRefresh] = useState(0);
  const [listingFacts, setListingFacts] = useState<
    Record<string, { propertyId?: string; bookmark?: boolean; inCollection?: boolean; proposed?: boolean }>
  >({});
  const action = useApiAction();
  const launchLock = useRef(false);
  const launchKey = useRef<{ payload: string; key: string } | null>(null);
  const [searchBusy, setSearchBusy] = useState(!!initialRun && ["queued", "running"].includes(initialRun.status));

  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    let active = true;
    apiCall<Saved[]>("GET", "/api/v1/property-search/saved-searches")
      .then((items) => {
        if (active) setSaved(items);
      })
      .catch(() => {
        /* Full error/retry is available in Мои поиски. */
      });
    if (!initialAvailability) {
      apiCall<SearchRuntimeAvailability>("GET", "/api/v1/property-search/availability")
        .then((next) => {
          if (active) setAvailability(next);
        })
        .catch(() => {
          /* Fallback props remain active if availability endpoint fails. */
        });
    }
    return () => {
      active = false;
    };
  }, [initialAvailability]);

  const aiPresentation = describeAiAvailability(availability, aiEnabled);
  const effectiveAiReady = availability ? availability.ai.available : aiEnabled;
  const effectiveManualWeb = availability ? availability.manualWeb : manualWebAllowed;
  const activeAdvancedCount = countActiveAdvancedFilters(filters, depth, deadlineSeconds);
  const activeAdvancedBadges = summarizeActiveAdvancedFilters(filters, depth, deadlineSeconds);
  const enabledSourcesCount = availability
    ? availability.sources.filter((s) => s.enabled).length
    : filters.sources.length;

  async function chooseProfile(id: string) {
    const profile = saved.find((item) => item.id === id);
    if (!profile) {
      setSavedId(undefined);
      setSavedName("");
      return;
    }
    setFilters(profile.filters);
    setSavedId(id);
    setSavedName(profile.name);
    setNeedId(profile.needId ?? "");
    setNeed(null);
    setClient(null);
    setDirty(false);
    if (profile.needId) {
      const result = await action.run(() =>
        apiCall<{ items: NeedChoice[] }>("GET", `/api/v1/property-search/pick-needs?needId=${profile.needId}`),
      );
      if (result) {
        setNeed(result.items[0] ?? null);
        setClient(result.items[0]?.client ?? null);
      }
    }
  }

  function edit<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function resetAdvanced() {
    setFilters((current) => resetAdvancedSearchFilters(current));
    setDepth(DEFAULT_SEARCH_DEPTH);
    setDeadlineSeconds(DEFAULT_DEADLINE_SECONDS);
    setDirty(true);
    setFeedback("Расширенные фильтры сброшены");
  }

  async function search(confirmedPaid = false, nextFilters = filters, nextSavedId = savedId, nextNeedId = needId) {
    if (launchLock.current) return;
    launchLock.current = true;
    setSearchBusy(true);
    setPhase("search");
    const result = await action.run(async () => {
      const checked = SearchFilters.safeParse(nextFilters);
      if (!checked.success)
        throw new ApiCallError(400, {
          code: "VALIDATION_ERROR",
          message: checked.error.issues.map((i) => i.message).join("; "),
          fieldErrors: Object.fromEntries(checked.error.issues.map((i) => [i.path.join("."), [i.message]])),
        });
      const payload = JSON.stringify([checked.data, nextNeedId, nextSavedId, scenario, depth, deadlineSeconds]);
      if (launchKey.current?.payload !== payload) launchKey.current = { payload, key: crypto.randomUUID() };
      return apiCall<Run>("POST", "/api/v1/property-search/runs", {
        idempotencyKey: launchKey.current.key,
        depth,
        deadlineMs: deadlineSeconds * 1000,
        filters: checked.data,
        sources: checked.data.sources,
        needId: nextNeedId || undefined,
        savedSearchId: nextSavedId,
        confirmedPaid,
        demoScenario: scenario,
      });
    });
    setPhase(null);
    launchLock.current = false;
    setSearchBusy(!!result && ["queued", "running"].includes(result.status));
    if (result) {
      launchKey.current = null;
      setComparison([]);
      setRun(result);
      setDirty(false);
      setFeedback("Поиск поставлен в очередь");
      setTab("confirmed");
      const url = new URL(window.location.href);
      url.searchParams.set("runId", result.id);
      window.history.replaceState(null, "", url);
    }
  }

  async function openTab(value: string) {
    setTab(value);
    if (value === "bookmarks") {
      const rows = await action.run(() => apiCall<Bookmark[]>("GET", "/api/v1/property-search/bookmarks"));
      if (rows) setBookmarks(rows);
    }
    if (value === "saved") {
      const rows = await action.run(() => apiCall<Saved[]>("GET", "/api/v1/property-search/saved-searches"));
      if (rows) setSaved(rows);
    }
  }

  async function listingAction(listing: Listing, name: string, extra: Record<string, unknown> = {}) {
    const result = await apiCall<{ id?: string }>("POST", `/api/v1/property-search/listings/${listing.id}/${name}`, extra);
    setListingFacts((current) => ({
      ...current,
      [listing.id]: {
        ...current[listing.id],
        ...(name === "transfer" && result.id ? { propertyId: result.id } : {}),
        ...(name === "bookmark" ? { bookmark: true } : {}),
        ...(name === "selection" ? { inCollection: true } : {}),
        ...(name === "propose" ? { proposed: true } : {}),
      },
    }));
    setFeedback(
      name === "transfer"
        ? "Объект сохранён в каталоге CRM"
        : name === "offer"
          ? "Объект добавлен в черновик КП"
          : "Изменения сохранены",
    );
    setResultRefresh((v) => v + 1);
    if (tab === "bookmarks") {
      const rows = await apiCall<Bookmark[]>("GET", "/api/v1/property-search/bookmarks");
      setBookmarks(rows);
    }
    return result;
  }

  async function selectNeed(value: NeedChoice | null) {
    setNeed(value);
    setNeedId(value?.id ?? "");
    setSavedId(undefined);
    setDirty(true);
    if (!value) return;
    setClient(value.client);
    const result = await action.run(() =>
      apiCall<{ filters: SearchFilters }>("GET", `/api/v1/property-search/pick-needs?needId=${value.id}`),
    );
    if (result) {
      setFilters(result.filters);
      setFeedback("Условия заполнены из потребности. Проверьте их перед поиском.");
    }
  }

  async function confirmPaid(kind: "search" | "web") {
    setLimits(null);
    setPaid(kind);
    const result = await action.run(() => apiCall<NonNullable<typeof limits>>("GET", "/api/v1/ai/limits"));
    if (result) setLimits(result);
  }

  function ResultActions({ listing }: { listing: Listing }) {
    const button = (kind: ListingDialogKind, label: string, disabled = false) => (
      <button
        type="button"
        className="btn btn-secondary"
        disabled={action.pending || disabled}
        onClick={() => setDialog({ listing, kind })}
      >
        {label}
      </button>
    );
    return (
      <div className="flex flex-wrap items-start gap-2">
        {listing.propertyId && (
          <div className="basis-full">
            <CatalogPhoto propertyId={listing.propertyId} address={listing.address} />
          </div>
        )}
        {button("bookmark", "В закладки")}
        {button("selection", "В подборку клиента", !needId)}
        <details className="relative">
          <summary className="btn btn-secondary cursor-pointer">Ещё</summary>
          <div className="mt-2 flex flex-wrap gap-2 rounded border bg-slate-50 p-2">
            {button("clarify", "Уточнить")}
            {listing.propertyId ? (
              <Link className="btn btn-secondary" href={`/properties/${listing.propertyId}`}>
                Открыть объект CRM
              </Link>
            ) : (
              button("transfer", "В каталог CRM")
            )}
            {button("propose", "Предложить клиенту", !needId)}
            {button("offer", "В КП", !needId)}
            {button("verification", "Проверка сотрудника")}
          </div>
        </details>
        {!needId && <span className="basis-full text-xs text-slate-500">Для подборки и КП выберите потребность выше.</span>}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {demoMode && (
        <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">
          DEMO · Режим тестирования: записанные ответы площадок
        </div>
      )}

      <section
        aria-label="Доступность источников и ИИ"
        className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={!availability || availability.scraper.enabled ? "green" : "yellow"}>
            {!availability || availability.scraper.enabled
              ? `Скрапер активен · площадок: ${enabledSourcesCount} из ${SOURCES.length}`
              : describeAvailabilityReason(availability.scraper.reason, "scraper")}
          </Badge>
          {availability && (
            <Badge tone={availability.browser.enabled ? "blue" : "gray"}>
              Браузерный режим: {availability.browser.enabled ? "включён" : "выключен"}
            </Badge>
          )}
          <Badge
            tone={
              aiPresentation.tone === "green"
                ? "green"
                : aiPresentation.tone === "yellow"
                  ? "yellow"
                  : "gray"
            }
          >
            {aiPresentation.badgeText}
          </Badge>
          {(aiPresentation.reason === "credentials_missing" ||
            aiPresentation.reason === "credential_store_unavailable") && (
            <span className="text-xs text-amber-900">
              {aiPresentation.detailText}{" "}
              <Link className="link font-medium" href={aiPresentation.settingsUrl}>
                {aiPresentation.actionLabel ?? "Настройки Яндекс AI"}
              </Link>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager ? (
            <>
              <Link className="btn btn-secondary" href="/settings/sources">
                Настроить источники поиска
              </Link>
              <Link className="btn btn-secondary" href={aiPresentation.settingsUrl}>
                {aiPresentation.reason === "credentials_missing" ? "Подключить Яндекс AI" : "Настройки Яндекс AI"}
              </Link>
            </>
          ) : (
            <span className="text-xs text-slate-500">
              Управление площадками и ключами Яндекс AI доступно руководителю
            </span>
          )}
        </div>
      </section>

      <Card title="Условия поиска">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-sm text-slate-600">
            <span>Основные параметры открыты по умолчанию</span>
            <HelpTooltip label="Справка: Условия поиска" text={SEARCH_HELP.primaryFilters} />
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span>Профиль поиска</span>
            <select
              aria-label="Профиль поиска"
              className="input"
              value={savedId ?? ""}
              onChange={(e) => void chooseProfile(e.target.value)}
            >
              <option value="">Текущие условия / новый поиск</option>
              {saved.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label>
            Город
            <input
              className="input mt-1 w-full"
              value={filters.city}
              onChange={(e) => {
                setFilters((f) => ({ ...f, city: e.target.value, districts: [] }));
                setDirty(true);
              }}
            />
          </label>
          <label>
            Операция
            <select
              className="input mt-1 w-full"
              value={filters.operation}
              onChange={(e) => {
                const op = e.target.value as "sale" | "rent";
                setFilters((f) => ({
                  ...f,
                  operation: op,
                  priceUnit: op === "sale" ? "rub_total" : "rub_month",
                }));
                setDirty(true);
              }}
            >
              <option value="sale">Продажа</option>
              <option value="rent">Аренда</option>
            </select>
          </label>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="search-price-unit">Единица цены</label>
              <HelpTooltip label="Справка: Единица цены" text={SEARCH_HELP.priceUnit} />
            </div>
            <select
              id="search-price-unit"
              className="input mt-1 w-full"
              value={filters.priceUnit ?? "rub_total"}
              onChange={(e) => edit("priceUnit", e.target.value as SearchFilters["priceUnit"])}
            >
              {(filters.operation === "sale"
                ? [["rub_total", "₽ за объект"]]
                : [
                    ["rub_month", "₽ в месяц"],
                    ["rub_year", "₽ в год"],
                    ["rub_m2_month", "₽/м² в месяц"],
                    ["rub_m2_year", "₽/м² в год"],
                  ]
              ).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ["priceFrom", "Цена от"],
              ["priceTo", "Цена до"],
              ["areaFrom", "Площадь от, м²"],
              ["areaTo", "Площадь до, м²"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className="input mt-1 w-full"
                type="number"
                min="0"
                step="0.01"
                value={filters[key] ?? ""}
                onChange={(e) =>
                  edit(
                    key,
                    e.target.value === ""
                      ? undefined
                      : key.startsWith("area")
                        ? Number(e.target.value)
                        : (e.target.value as never),
                  )
                }
              />
            </label>
          ))}
        </div>

        <fieldset className="mt-4">
          <legend className="flex items-center gap-1 text-sm font-medium">
            Назначения · ИЛИ
            <HelpTooltip label="Справка: Назначения объектов" text={SEARCH_HELP.purposes} />
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {PURPOSES.map((p) => (
              <span className="inline-flex items-center gap-1" key={p}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.purposes.includes(p)}
                    onChange={(e) =>
                      edit(
                        "purposes",
                        e.target.checked ? [...filters.purposes, p] : filters.purposes.filter((v) => v !== p),
                      )
                    }
                  />
                  {PURPOSE_LABELS[p]}
                </label>
                <HelpTooltip label={`Справка: ${PURPOSE_LABELS[p]}`} text={PURPOSE_HELP[p]} />
              </span>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>Площадки</span>
            <HelpTooltip label="Справка: Площадки поиска" text={SEARCH_HELP.sources} />
            {isManager && (
              <Link className="link text-xs font-normal" href="/settings/sources">
                Управление источниками и скрапером →
              </Link>
            )}
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {SOURCES.map((s) => {
              const sourceInfo = availability?.sources.find((item) => item.source === s);
              const disabledInRuntime = sourceInfo ? !sourceInfo.enabled : false;
              return (
                <span className="inline-flex items-center gap-1" key={s}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.sources.includes(s)}
                      onChange={(e) =>
                        edit(
                          "sources",
                          e.target.checked ? [...filters.sources, s] : filters.sources.filter((v) => v !== s),
                        )
                      }
                    />
                    {SOURCE_LABELS[s]}
                  </label>
                  {disabledInRuntime && sourceInfo && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                      {sourceInfo.reason === "disabled_by_server" ? "откл. ENV" : "откл. в настройках"}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              aria-expanded={advancedOpen}
              aria-controls="search-advanced-filters-panel"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              {advancedOpen ? "Скрыть расширенные фильтры" : "Расширенные фильтры"}
              {activeAdvancedCount > 0 ? ` (${activeAdvancedCount})` : ""}
            </button>
            <HelpTooltip label="Справка: Расширенные фильтры" text={SEARCH_HELP.advancedFilters} />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={activeAdvancedCount === 0}
              onClick={resetAdvanced}
            >
              Сбросить расширенные фильтры
            </button>
            {activeAdvancedCount > 0 && !advancedOpen && (
              <span className="text-xs text-slate-600">
                Активно условий: {activeAdvancedCount} (сохраняются при свёрнутом блоке)
              </span>
            )}
          </div>

          {!advancedOpen && activeAdvancedBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Активные расширенные условия">
              {activeAdvancedBadges.map((badge) => (
                <span
                  key={badge}
                  className=" rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs text-blue-950"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div
            id="search-advanced-filters-panel"
            hidden={!advancedOpen}
            className={advancedOpen ? "mt-3 space-y-4 rounded border border-slate-200 bg-slate-50/60 p-3" : "hidden"}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="search-floor-mode">Этаж</label>
                  <HelpTooltip label="Справка: Режим этажа" text={SEARCH_HELP.floorMode} />
                </div>
                <select
                  id="search-floor-mode"
                  className="input mt-1 w-full"
                  value={filters.floorMode}
                  onChange={(e) => edit("floorMode", e.target.value as SearchFilters["floorMode"])}
                >
                  <option value="any">Любой</option>
                  <option value="first_floor_only">Строго первый</option>
                  <option value="exclude_basement_and_semi_basement">Без подвала и цоколя</option>
                </select>
              </div>
              <DistrictPicker
                city={filters.city}
                value={filters.districts}
                onChange={(value) => edit("districts", value)}
              />
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="search-seller">Продавец</label>
                  <HelpTooltip label="Справка: Продавец" text={SEARCH_HELP.seller} />
                </div>
                <select
                  id="search-seller"
                  className="input mt-1 w-full"
                  value={filters.seller}
                  onChange={(e) => edit("seller", e.target.value as SearchFilters["seller"])}
                >
                  <option value="all">Все</option>
                  <option value="confirmed_owner_only">Только проверенный собственник</option>
                  <option value="agent">Посредник</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="search-required-features">Обязательные признаки</label>
                  <HelpTooltip label="Справка: Обязательные признаки" text={SEARCH_HELP.requiredFeatures} />
                </div>
                <textarea
                  id="search-required-features"
                  className="input mt-1 w-full"
                  value={filters.requiredFeatures.join("; ")}
                  onChange={(e) =>
                    edit(
                      "requiredFeatures",
                      e.target.value.split(";").map((s) => s.trimStart()),
                    )
                  }
                  onBlur={() => edit("requiredFeatures", split(filters.requiredFeatures.join(";")))}
                  placeholder="Отдельный вход; витрина"
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="search-preferred-features">Желательные признаки</label>
                  <HelpTooltip label="Справка: Желательные признаки" text={SEARCH_HELP.preferredFeatures} />
                </div>
                <textarea
                  id="search-preferred-features"
                  className="input mt-1 w-full"
                  value={filters.preferredFeatures.join("; ")}
                  onChange={(e) =>
                    edit(
                      "preferredFeatures",
                      e.target.value.split(";").map((s) => s.trimStart()),
                    )
                  }
                  onBlur={() => edit("preferredFeatures", split(filters.preferredFeatures.join(";")))}
                />
              </div>
            </div>

            <fieldset className="rounded border bg-white p-3">
              <legend className="flex items-center gap-1 px-1 text-sm font-medium">
                Глубина и время поиска
                <HelpTooltip label="Справка: Глубина и время поиска" text={SEARCH_HELP.depth} />
              </legend>
              <div className="mt-2 flex flex-wrap gap-3">
                <label>
                  Страниц на источник
                  <input
                    type="number"
                    className="input block"
                    min={1}
                    max={10}
                    value={depth.maxPages}
                    onChange={(e) => setDepth((v) => ({ ...v, maxPages: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Объявлений на источник
                  <input
                    type="number"
                    className="input block"
                    min={1}
                    max={500}
                    value={depth.limit}
                    onChange={(e) => setDepth((v) => ({ ...v, limit: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Общий срок, секунд
                  <input
                    type="number"
                    className="input block"
                    min={1}
                    max={600}
                    value={deadlineSeconds}
                    onChange={(e) => setDeadlineSeconds(Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                По умолчанию до 14 страниц для семи источников. Сервер ограничивает глубину каждой площадки безопасными
                пределами; фактический охват указан в прогрессе.
              </p>
            </fieldset>

            <QueryRefinement
              key={JSON.stringify(filters)}
              currentFilters={filters}
              enabled={effectiveAiReady}
              statusMessage={
                aiPresentation.reason === "credentials_missing" ||
                aiPresentation.reason === "credential_store_unavailable"
                  ? aiPresentation.badgeText
                  : null
              }
              settingsUrl={aiPresentation.settingsUrl}
              onConfirmed={(value) => {
                setFilters(value);
                setDirty(true);
                setFeedback("Условия подтверждены. Проверьте форму перед поиском.");
              }}
            />
          </div>

          <CatalogFilters
            filters={filters}
            collapsed={!advancedOpen}
            onChange={(value) => {
              setFilters(value);
              setDirty(true);
            }}
          />
        </div>

        {dirty && run && (
          <p role="status" className="mb-3 rounded bg-amber-50 p-3">
            Условия формы изменены. Нажмите «Искать» для нового запуска. Свежесть и сортировка текущей выдачи
            применяются отдельно.
          </p>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <SearchPicker<ClientChoice>
            label="Клиент (необязательно)"
            url="/api/v1/clients/pick"
            value={client}
            render={(c) => c.displayName}
            onChange={(value) => {
              setClient(value);
              setNeed(null);
              setNeedId("");
              setSavedId(undefined);
              setDirty(true);
            }}
          />
          <SearchPicker<NeedChoice>
            label="Потребность (необязательно)"
            url={`/api/v1/property-search/pick-needs${client ? `?clientId=${client.id}` : ""}`}
            value={need}
            render={(n) => `${n.client?.displayName ?? "Клиент недоступен"} · ${n.label}`}
            onChange={(value) => void selectNeed(value)}
          />
          {needId && (
            <Link className="link" href={`/needs/${needId}`}>
              Открыть потребность
            </Link>
          )}
          {demoMode && (
            <label>
              Записанный сценарий
              <select className="input ml-2" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                <option value="success">Успех</option>
                <option value="partial">Частичный отказ</option>
                <option value="failure">Полный отказ → веб-резерв</option>
                <option value="empty">Исправный пустой ответ</option>
              </select>
            </label>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={action.pending || searchBusy}
            onClick={() => (effectiveAiReady ? void confirmPaid("search") : void search())}
          >
            Искать
          </button>
          {run && effectiveManualWeb && !run.webSearchUsed && (
            <button className="btn btn-secondary" disabled={action.pending} onClick={() => void confirmPaid("web")}>
              Веб-поиск
            </button>
          )}
        </div>
      </Card>

      <FormErrorBanner error={action.error} />
      {!run && <SearchProgress phase={phase} completed={false} />}
      {action.pending && !phase && (
        <p role="status" className="text-sm text-slate-500">
          Загрузка…
        </p>
      )}
      {feedback && (
        <p role="status" className="text-sm text-emerald-700">
          {feedback}
        </p>
      )}
      {comparison.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-white p-3">
          <span className="text-sm">Выбрано для сравнения: {comparison.length} / 4</span>
          <button className="btn btn-primary" disabled={comparison.length < 2} onClick={() => setCompareOpen(true)}>
            Сравнить
          </button>
          <button className="btn btn-secondary" onClick={() => setComparison([])}>
            Сбросить
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Результаты поиска" className="flex flex-wrap gap-2">
          {[
            ["confirmed", "Результаты"],
            ["bookmarks", "Закладки"],
            ["saved", "Мои поиски"],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              key={id}
              className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => void openTab(id!)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Вид{" "}
          <select aria-label="Вид" className="input" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="cards">Карточки</option>
            <option value="table">Таблица</option>
          </select>
        </label>
      </div>

      {tab === "saved" ? (
        <Card title="Мои поиски">
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              aria-label="Название поиска"
              className="input"
              value={savedName}
              onChange={(e) => {
                setSavedName(e.target.value);
                setDirty(true);
              }}
              placeholder="Название поиска"
            />
            <button
              className="btn btn-primary"
              disabled={action.pending || !savedName.trim()}
              onClick={async () => {
                const result = await action.run(() =>
                  apiCall<Saved>(
                    savedId ? "PATCH" : "POST",
                    `/api/v1/property-search/saved-searches${savedId ? `/${savedId}` : ""}`,
                    {
                      name: savedName,
                      filters,
                      sources: filters.sources,
                      needId: needId || null,
                      ...(savedId ? { expectedUpdatedAt: saved.find((s) => s.id === savedId)?.updatedAt } : {}),
                    },
                  ),
                );
                if (result) {
                  setSavedId(result.id);
                  setDirty(false);
                  setFeedback("Поиск сохранён");
                  await openTab("saved");
                }
              }}
            >
              Сохранить условия
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSavedId(undefined);
                setSavedName("");
              }}
            >
              Новый поиск
            </button>
          </div>
          {saved.length === 0 && (
            <EmptyState title="Нет сохранённых поисков" hint="Сохраните текущие условия под понятным названием." />
          )}
          {saved.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
              <span>
                {s.name} · {s.filters.city}
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setFilters(s.filters);
                    setSavedId(s.id);
                    setNeedId(s.needId ?? "");
                    setNeed(null);
                    setClient(null);
                    if (s.needId) {
                      void action.run(async () => {
                        const picked = await apiCall<{ items: NeedChoice[] }>(
                          "GET",
                          `/api/v1/property-search/pick-needs?needId=${s.needId}`,
                        );
                        setNeed(picked.items[0] ?? null);
                        setClient(picked.items[0]?.client ?? null);
                        return picked;
                      });
                    }
                    setSavedName(s.name);
                    setDirty(false);
                    setFeedback("Условия загружены. Проверьте и нажмите «Искать».");
                  }}
                >
                  Открыть / запустить
                </button>
                <button className="btn btn-secondary" disabled={action.pending} onClick={() => setDeleteId(s.id)}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </Card>
      ) : tab === "bookmarks" ? (
        <div className="space-y-3">
          {!bookmarks.length && (
            <EmptyState title="Закладок пока нет" hint="Сохраните интересное объявление из результатов поиска." />
          )}
          {bookmarks.map((b) => (
            <Card key={b.id} title={resultAddress(null, b.listing)}>
              <p className="mb-3">{b.note ?? "Без заметки"}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <select
                  aria-label="Статус закладки"
                  className="input"
                  value={b.status}
                  onChange={async (e) => {
                    await action.run(() =>
                      listingAction(b.listing, "bookmark", { status: e.target.value, note: b.note }),
                    );
                    await openTab("bookmarks");
                  }}
                >
                  <option value="study">Изучить</option>
                  <option value="clarify">Уточнить</option>
                  <option value="exclude">Исключить</option>
                </select>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    setDialog({ listing: b.listing, kind: "bookmark", note: b.note ?? "", extra: { status: b.status } })
                  }
                >
                  Заметка
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    await action.run(() => apiCall("DELETE", `/api/v1/property-search/bookmarks/${b.id}`));
                    await openTab("bookmarks");
                  }}
                >
                  Удалить закладку
                </button>
                <a className="link" href={b.listing.url} target="_blank" rel="noopener noreferrer">
                  Источник ↗
                </a>
              </div>
              <ResultActions listing={b.listing} />
            </Card>
          ))}
        </div>
      ) : run ? (
        <SearchResultsV31
          key={run.id}
          runId={run.id}
          externalRefresh={resultRefresh}
          knownFacts={listingFacts}
          filters={filters}
          needId={needId}
          aiEnabled={effectiveAiReady}
          aiStatusMessage={
            aiPresentation.reason === "credentials_missing" ||
            aiPresentation.reason === "credential_store_unavailable"
              ? aiPresentation.badgeText
              : null
          }
          aiSettingsUrl={aiPresentation.settingsUrl}
          replay={!!initialRun && initialRun.id === run.id}
          replayDate={initialRun?.finishedAt ?? initialRun?.startedAt}
          view={view}
          onBusy={setSearchBusy}
          onCompare={(rows) => {
            setComparison(rows as Result[]);
            setCompareOpen(true);
          }}
          renderActions={(listing) => <ResultActions listing={listing as Listing} />}
        />
      ) : null}

      {dialog && (
        <ListingDialog
          key={`${dialog.listing.id}-${dialog.kind}`}
          kind={dialog.kind}
          address={dialog.listing.address}
          url={dialog.listing.url}
          initialNote={dialog.note}
          needsTransfer={["offer", "propose"].includes(dialog.kind) && !dialog.listing.propertyId}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            if (["offer", "propose"].includes(dialog.kind) && !dialog.listing.propertyId)
              await listingAction(dialog.listing, "transfer", {
                confirmed: true,
                identityConfirmed: body.identityConfirmed,
                address: body.address,
                operation: filters.operation,
              });
            return listingAction(dialog.listing, dialog.kind, {
              ...body,
              ...dialog.extra,
              ...(needId ? { needId } : {}),
              ...(dialog.kind === "transfer" ? { operation: filters.operation } : {}),
            });
          }}
        />
      )}
      {deleteId && (
        <ListingDialog
          kind="delete"
          onClose={() => setDeleteId(null)}
          onSubmit={async () => {
            const result = await apiCall("DELETE", `/api/v1/property-search/saved-searches/${deleteId}`);
            await openTab("saved");
            return result;
          }}
        />
      )}
      <Modal open={compareOpen} wide title="Сравнение объявлений" onClose={() => setCompareOpen(false)}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <caption className="mb-3 text-left text-slate-500">
              Сравниваются 2–4 объявления. Неизвестные сведения отмечены «—».
            </caption>
            <thead>
              <tr>
                <th className="p-2">Характеристика</th>
                {comparison.map((r) => (
                  <th className="max-w-64 p-2" key={r.id}>
                    <a className="link" href={r.listing.url} target="_blank" rel="noopener noreferrer">
                      {resultAddress(r.snapshot, r.listing)} ↗
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Источник", (r: Result) => SOURCE_LABELS[r.listing.source]],
                  ["Объявление", (r: Result) => resultTitle(r.snapshot, r.listing) ?? "Заголовок не сохранён площадкой"],
                  [
                    "Цена",
                    (r: Result) =>
                      `${numberText(r.snapshot?.price ?? r.listing.priceRub)} ₽ · ${resultPriceUnit(
                        r.snapshot,
                        r.listing,
                        run?.filters?.operation ?? initialFilters.operation,
                      )}`,
                  ],
                  ["Площадь", (r: Result) => `${numberText(r.snapshot?.area ?? r.listing.areaM2)} м²`],
                  ["Этаж", (r: Result) => r.snapshot?.floor?.raw ?? r.listing.floorRaw ?? "—"],
                  ["Район", (r: Result) => r.snapshot?.district ?? "—"],
                  [
                    "Проверка",
                    (r: Result) =>
                      r.verdict === "confirmed"
                        ? "Совпадение"
                        : r.verdict === "rejected"
                          ? "Исключено"
                          : "Требует проверки",
                  ],
                ] as const
              ).map(([label, render]) => (
                <tr className="border-t" key={label}>
                  <th className="p-2">{label}</th>
                  {comparison.map((r) => (
                    <td className="p-2 align-top" key={r.id}>
                      {render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t">
                <th className="p-2">Доказательства</th>
                {comparison.map((r) => (
                  <td className="p-2 align-top" key={r.id}>
                    <Evidence criteria={r.criteria} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>
      <Modal
        open={!!paid}
        title="Подтверждение платного поиска"
        onClose={() => {
          if (!action.pending) setPaid(null);
        }}
      >
        <div className="space-y-4">
          <p>
            Проверьте условия. Анализ объявлений
            {paid === "web" ? " и отдельный веб-поиск" : " и разрешённый веб-резерв"} используют лимиты ИИ.
          </p>
          {limits ? (
            <dl className="grid grid-cols-2 gap-2 rounded border p-3 text-sm">
              <dt>Запросов в час</dt>
              <dd>{limits.remaining.hour}</dd>
              <dt>Запросов сегодня</dt>
              <dd>{limits.remaining.day}</dd>
              <dt>Веб-поисков сегодня</dt>
              <dd>{limits.remaining.webJobsToday}</dd>
              <dt>Остаток бюджета месяца</dt>
              <dd>
                {limits.remaining.monthlyBudgetRub !== undefined
                  ? `${numberText(limits.remaining.monthlyBudgetRub)} ₽`
                  : limits.budgetAvailable
                    ? "Доступен"
                    : "Исчерпан"}
              </dd>
            </dl>
          ) : (
            <p role="status">
              {action.pending ? "Проверяем доступный лимит…" : "Не удалось получить лимиты. Закройте окно и повторите."}
            </p>
          )}
          <FormErrorBanner error={action.error} />
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn btn-secondary" disabled={action.pending} onClick={() => setPaid(null)}>
              Отмена
            </button>
            <button
              className="btn btn-primary"
              disabled={
                action.pending ||
                !limits ||
                !limits.modes.ai ||
                !limits.budgetAvailable ||
                !limits.remaining.hour ||
                !limits.remaining.day ||
                (paid === "web" && (!limits.modes.manualWeb || !limits.remaining.webJobsToday))
              }
              onClick={async () => {
                const kind = paid;
                setPaid(null);
                if (kind === "search") await search(true);
                else if (run) {
                  setPhase("web");
                  const result = await action.run(() =>
                    apiCall<Run>("POST", `/api/v1/property-search/runs/${run.id}/web-search`),
                  );
                  setPhase(null);
                  if (result) setRun(result);
                }
              }}
            >
              Подтверждаю запуск
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Evidence({ criteria }: { criteria: CriterionEvaluation[] }) {
  return (
    <details className="my-3">
      <summary className="cursor-pointer text-sm font-medium">Доказательства по критериям ({criteria.length})</summary>
      <ul className="mt-2 space-y-2">
        {criteria.map((c, index) => (
          <li key={index} className="rounded border p-2 text-sm">
            <Badge tone={c.state === "matched" ? "green" : c.state === "contradicted" ? "red" : "yellow"}>
              {evidenceLabel("criterion_state", c.state)}
            </Badge>{" "}
            <strong>{evidenceLabel("criterion", c.criterion)}</strong> · {evidenceLabel("criterion_source", c.source)}
            <p className="mt-1 text-slate-600">{evidenceText(c)}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function evidenceText(c: CriterionEvaluation): string {
  return translatedEvidence(c.evidence || "Нет данных");
}
