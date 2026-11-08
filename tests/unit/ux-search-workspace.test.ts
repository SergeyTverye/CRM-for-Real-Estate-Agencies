import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { displayLabel, evidenceLabel } from "@/shared/codebook";
import { PURPOSES, SearchFilters } from "@/modules/property-search/domain/types";
import {
  DEFAULT_DEADLINE_SECONDS,
  DEFAULT_SEARCH_DEPTH,
  PURPOSE_HELP,
  PURPOSE_LABELS,
  countActiveAdvancedFilters,
  describeAiAvailability,
  describeAvailabilityReason,
  formatPurposeLabel,
  resetAdvancedSearchFilters,
  summarizeActiveAdvancedFilters,
  type SearchRuntimeAvailability,
} from "@/app/(crm)/property-search/filter-presentation";
import { HelpTooltip } from "@/app/(crm)/property-search/help-tooltip";
import { CatalogFilters } from "@/app/(crm)/property-search/catalog-filters";
import { QueryRefinement } from "@/ui/listing-analysis/query-refinement";
import { ListingAnalysisPanel } from "@/ui/listing-analysis/listing-analysis-panel";
import { describeCredentialStatus } from "@/app/(crm)/settings/ai/ai-credentials-card";
import { NAV_ITEMS } from "@/ui/shell/nav-config";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => "/property-search",
  useSearchParams: () => new URLSearchParams(),
}));

function visibleNav(isManager: boolean): string[] {
  return NAV_ITEMS.filter((item) => !item.managerOnly || isManager).map((item) => item.href);
}

const baseFilters: SearchFilters = SearchFilters.parse({
  city: "Саратов",
  operation: "rent",
  priceUnit: "rub_month",
  priceFrom: "50000",
  areaFrom: 45,
  purposes: ["retail", "residential"],
  floorMode: "any",
  districts: [],
  seller: "all",
  requiredFeatures: [],
  preferredFeatures: [],
  sources: ["cian", "domclick"],
  features: { separate_entrance: true },
  freshness: { mode: "published", period: "7", includeUnknown: false },
});

describe("Property Search UI/UX presentation and availability helpers", () => {
  it("renders 'Жилая' for residential purpose across search labels and codebooks", () => {
    expect(PURPOSES).toContain("residential");
    for (const code of PURPOSES) {
      expect(PURPOSE_LABELS[code]).toBeTruthy();
      expect(PURPOSE_HELP[code]).toBeTruthy();
    }
    expect(PURPOSE_LABELS.residential).toBe("Жилая");
    expect(formatPurposeLabel("residential")).toBe("Жилая");
    expect(displayLabel("property_type", "residential")).toBe("Жилая");
    expect(evidenceLabel("property_type", "residential")).toBe("Жилая");
  });

  it("counts, summarizes, and resets advanced filters while keeping primary filters intact", () => {
    const plainBase: SearchFilters = SearchFilters.parse({
      city: "Саратов",
      operation: "rent",
      priceUnit: "rub_month",
      priceFrom: "50000",
      areaFrom: 45,
      purposes: ["retail", "residential"],
      floorMode: "any",
      districts: [],
      seller: "all",
      requiredFeatures: [],
      preferredFeatures: [],
      sources: ["cian", "domclick"],
    });
    expect(plainBase.priceUnit).toBe("rub_month");
    expect(plainBase.freshness).toBeUndefined();
    expect(countActiveAdvancedFilters(plainBase)).toBe(0);
    expect(summarizeActiveAdvancedFilters(plainBase)).toEqual([]);

    const withAdvanced: SearchFilters = {
      ...plainBase,
      floorMode: "first_floor_only",
      districts: ["Волжский", "Кировский"],
      seller: "confirmed_owner_only",
      requiredFeatures: ["мокрая точка"],
      features: { separate_entrance: true, power_kw: { min: 15 } },
      hasPhotos: true,
      verification: "checked",
      freshness: { mode: "published", period: "7", includeUnknown: true },
    };

    const customDepth = { maxPages: 4, limit: 200 };
    expect(countActiveAdvancedFilters(withAdvanced, customDepth, 240)).toBe(10);

    const summary = summarizeActiveAdvancedFilters(withAdvanced, customDepth, 240);
    expect(summary).toContain("Этаж: строго первый");
    expect(summary).toContain("Продавец: проверенный собственник");
    expect(summary).toContain("Обязательно: мокрая точка");
    expect(summary).toContain("Отдельный вход: да");
    expect(summary).toContain("Мощность кВт: 15–—");
    expect(summary).toContain("Глубина: 4 стр. / 200 объ. / 240 с");

    const reset = resetAdvancedSearchFilters(withAdvanced);
    expect(reset.city).toBe("Саратов");
    expect(reset.operation).toBe("rent");
    expect(reset.priceUnit).toBe("rub_month");
    expect(reset.purposes).toEqual(["retail", "residential"]);
    expect(reset.priceFrom).toBe("50000");
    expect(reset.areaFrom).toBe(45);
    expect(reset.sources).toEqual(["cian", "domclick"]);
    expect(reset.floorMode).toBe("any");
    expect(reset.districts).toEqual([]);
    expect(reset.seller).toBe("all");
    expect(reset.requiredFeatures).toEqual([]);
    expect(countActiveAdvancedFilters(reset, DEFAULT_SEARCH_DEPTH, DEFAULT_DEADLINE_SECONDS)).toBe(0);
  });

  it("distinguishes missing AI credentials from disabled AI and links to /settings/ai", () => {
    const missingCredsAvailability: SearchRuntimeAvailability = {
      scraper: { enabled: true, reason: "ready" },
      browser: { enabled: true, configured: true },
      sources: [{ source: "cian", enabled: true, reason: "ready" }],
      ai: {
        enabled: true,
        configured: false,
        available: false,
        reason: "credentials_missing",
        message: "Требуется подключение Яндекс AI",
        settingsUrl: "/settings/ai",
      },
      manualWeb: false,
      autoFallback: false,
    };

    const aiStatus = describeAiAvailability(missingCredsAvailability, true);
    expect(aiStatus.ready).toBe(false);
    expect(aiStatus.badgeText).toBe("Требуется подключение Яндекс AI");
    expect(aiStatus.badgeText).not.toContain("ИИ отключён");
    expect(aiStatus.detailText).toContain("Требуется подключение Яндекс AI");
    expect(aiStatus.settingsUrl).toBe("/settings/ai");

    const credCard = describeCredentialStatus(
      { configured: false, source: "none", editable: true, status: "missing" },
      true,
    );
    expect(credCard.headline).toBe("Требуется подключение Яндекс AI");
    expect(credCard.tone).toBe("yellow");
  });

  it("renders accessible HelpTooltip and preserves applied filter summary when CatalogFilters is collapsed", () => {
    const tooltipHtml = renderToStaticMarkup(
      createElement(HelpTooltip, { label: "Подсказка по назначению", text: PURPOSE_HELP.residential }),
    );
    expect(tooltipHtml).toContain('aria-label="Подсказка по назначению"');
    expect(tooltipHtml).toContain('aria-expanded="false"');

    const collapsedFiltersHtml = renderToStaticMarkup(
      createElement(CatalogFilters, {
        filters: baseFilters,
        collapsed: true,
        onChange: () => undefined,
      }),
    );
    expect(collapsedFiltersHtml).toContain("Применённые фильтры:");
    expect(collapsedFiltersHtml).toContain("Торговля ИЛИ Жилая");
    expect(collapsedFiltersHtml).toContain("Отдельный вход: есть");
    expect(collapsedFiltersHtml).toContain("ИЛИ между назначениями, И между остальными обязательными");
  });

  it("renders actionable missing-credentials state in QueryRefinement and ListingAnalysisPanel", () => {
    const refinementHtml = renderToStaticMarkup(
      createElement(QueryRefinement, {
        currentFilters: baseFilters,
        onConfirmed: () => undefined,
        enabled: false,
        statusMessage: "Требуется подключение Яндекс AI",
        settingsUrl: "/settings/ai",
      }),
    );
    expect(refinementHtml).toContain("Требуется подключение Яндекс AI");
    expect(refinementHtml).toContain('href="/settings/ai"');
    expect(refinementHtml).not.toContain("ИИ отключён");

    const analysisHtml = renderToStaticMarkup(
      createElement(ListingAnalysisPanel, {
        listingIds: ["listing-1"],
        filters: baseFilters,
        enabled: false,
        statusMessage: "Требуется подключение Яндекс AI",
        settingsUrl: "/settings/ai",
      }),
    );
    expect(analysisHtml).toContain("Требуется подключение Яндекс AI");
    expect(analysisHtml).toContain('href="/settings/ai"');
  });

  it("exposes dedicated /settings/sources and /settings/ai routes in manager navigation", () => {
    expect(visibleNav(true)).toContain("/settings/sources");
    expect(visibleNav(true)).toContain("/settings/ai");
    expect(visibleNav(false)).not.toContain("/settings/sources");
    expect(visibleNav(false)).not.toContain("/settings/ai");
  });

  it("presents tariff_unavailable distinctly with manual search and settings link", () => {
    const tariffAvailability: SearchRuntimeAvailability = {
      scraper: { enabled: true, reason: "ready" },
      browser: { enabled: true, configured: true },
      sources: [{ source: "cian", enabled: true, reason: "ready" }],
      ai: {
        enabled: true,
        configured: true,
        available: false,
        reason: "tariff_unavailable",
        message:
          "Для выбранной модели ИИ нет действующего полного тарифа. Руководителю: добавьте тариф или выберите модель с действующим тарифом в настройках ИИ. Ручной поиск доступен.",
        settingsUrl: "/settings/ai",
      },
      manualWeb: false,
      autoFallback: false,
    };
    const tariff = describeAiAvailability(tariffAvailability, true);
    expect(tariff.ready).toBe(false);
    expect(tariff.reason).toBe("tariff_unavailable");
    expect(tariff.tone).toBe("yellow");
    expect(tariff.badgeText).toBe("Нет действующего тарифа ИИ");
    expect(tariff.badgeText).not.toContain("ИИ отключён");
    expect(tariff.badgeText).not.toBe("Требуется подключение Яндекс AI");
    expect(tariff.detailText).toContain("тарифа");
    expect(tariff.detailText).toContain("ручные фильтры");
    expect(tariff.detailText).toContain("без подтверждения оплаты");
    expect(tariff.actionLabel).toBe("Настроить тарифы ИИ");
    expect(tariff.settingsUrl).toBe("/settings/ai");
    expect(tariff.enabledInSettings).toBe(true);

    expect(describeAvailabilityReason("tariff_unavailable", "ai")).toBe("Нет действующего тарифа ИИ");
    expect(describeAvailabilityReason("credentials_missing", "ai")).not.toBe(
      describeAvailabilityReason("tariff_unavailable", "ai"),
    );
    expect(describeAvailabilityReason("disabled_by_settings", "ai")).toBe("Отключён в настройках агентства");

    const disabled = describeAiAvailability(
      {
        ...tariffAvailability,
        ai: { ...tariffAvailability.ai, reason: "disabled_by_settings", available: false },
      },
      true,
    );
    expect(disabled.badgeText).toContain("ИИ отключён");
    expect(disabled.tone).toBe("slate");
  });
});

it.each([0,1,11])("disables AI ranking outside 2–10 selection (%i)", count=>{
  const html=renderToStaticMarkup(createElement(ListingAnalysisPanel,{listingIds:Array.from({length:count},(_,n)=>String(n)),filters:baseFilters}));
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ранжировать выбранные с ИИ<\/button>/);
});
it.each([2,10])("offers a separate AI ranking for %i listings", count=>{
  const html=renderToStaticMarkup(createElement(ListingAnalysisPanel,{listingIds:Array.from({length:count},(_,n)=>String(n)),filters:baseFilters}));
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Ранжировать выбранные с ИИ<\/button>/);
});
