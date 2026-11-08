import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { SearchResultsV31 } from "@/app/(crm)/property-search/search-results-v31";

const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[], selected: false }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    const index = state.index++;
    return react.useState(index < state.values.length ? state.values[index] :
      initial instanceof Map && state.selected ? new Map([["listing", { listingId: "listing", snapshot: null }]]) : initial);
  } };
});
vi.mock("@/ui/listing-analysis/listing-analysis-panel", () => ({ ListingAnalysisPanel: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const snapshot: NormalizedListing = {
  source: "onrealt", sourceListingId: "synthetic", sourceUnitId: null,
  url: "https://onrealt.ru/novosibirsk/kypit-ofis/12345678",
  purpose: "office", operation: "rent", price: "100000", priceUnit: null, area: 100,
  floor: { kind: "above_ground", number: 1, raw: "1" }, city: "Новосибирск",
  district: null, address: "Синтетическая улица, 1", title: "Тестовый офис",
  seller: { type: "unknown" }, description: "", images: [], fetchedAt: "2026-11-08T10:00:00Z",
  structuredFeatures: {}, possibleDuplicateKeys: ["other-source"], identityNeedsReview: false,
};
const filters = SearchFilters.parse({ operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources: ["onrealt", "yandex"] });
function render(view: string, verdict = "needs_review", selected = false) {
  state.selected = selected;
  state.index = 0;
  state.values = [
    { id: "run", status: "partial", cancelRequested: false, sources: [
      { source: "onrealt", status: "success", resultCount: 1, reason: null, durationMs: 100 },
      { source: "yandex", status: "blocked", resultCount: 0, reason: "CAPTCHA", durationMs: 100 },
    ] },
    { page: 1, total: 1, revision: "r1", counts: { confirmed: 0, needs_review: 1 }, unknownDateCount: 1, incomplete: true, duplicateGroups: [], rows: [{
      id: "row", listingId: "listing", source: snapshot.source, url: snapshot.url, verdict, snapshot,
      criteria: [
        { criterion: "area", state: "matched", source: "structured", evidence: "100 м²" },
        { criterion: "feature", state: "unknown", source: "ai", evidence: "Витрина не подтверждена" },
      ],
      publishedAt: null, firstSeenAt: "2026-11-08T10:00:00Z", datePrecision: "unknown",
      pricePerM2Rub: null, pricePerM2Unit: null, isNew: false, priceChanged: false,
    }] },
    false,
  ];
  return renderToStaticMarkup(createElement(SearchResultsV31, {
    runId: "run", externalRefresh: 0, knownFacts: {}, filters, needId: "", aiEnabled: false,
    replay: false, view, onCompare: vi.fn(), onBusy: vi.fn(), renderActions: () => null,
  }));
}
beforeEach(() => { state.index = 0; state.values = []; state.selected = false; });
describe("P0-C result table and cards", () => {
  it.each(["table", "cards"])("keeps facts, unknowns, duplicates, source failures and actions visible in %s", view => {
    const html = render(view);
    for (const label of ["Синтетическая улица, 1", "100", "м²", "этаж", "Офис", "OnRealt", "Заблокирован",
      "Выборка неполная", "Требует проверки", "Возможный дубль", "Площадка не указала: единица цены, район",
      "Вывод AI — требует проверки", "предположения", "В подборку", "К сравнению", "Открыть источник", "Сохранить", "Экспорт",
      "Фотографии у первоисточника", "неизвестн" ]) expect(html, label).toContain(label);
    expect(html).toContain("border-violet-300");
    expect(html).not.toContain("100 000 ₽ · в месяц");
  });
  it.each(["table", "cards"])("renders an explicit confirmed verdict in %s", view => {
    expect(render(view, "confirmed")).toContain("Подходит");
  });
  it("reveals bulk actions automatically after selection and collapses them otherwise", () => {
    expect(render("table")).not.toContain('open="" class="text-sm"');
    const selected = render("table", "needs_review", true);
    expect(selected).toContain('open="" class="text-sm"');
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).toContain("В именованную подборку");
  });

});

