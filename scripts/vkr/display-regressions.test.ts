import { expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { listingFields } from "@/modules/property-search/infrastructure/listing-fields";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { resultAddress, resultTitle, resultPriceUnit, evidenceLabel, translatedEvidence } from "@/app/(crm)/property-search/result-display";
vi.mock("@/shared/db/client", () => ({ db: {} }));
import { offerCharacteristics } from "@/modules/commercial-offers/application/offer-print-data";

const raw = (source: RealEstateScraper.Source): RealEstateScraper.Listing => ({ source, id: "offline-1", url: "https://realty.yandex.ru/offer/123/", title: "Офис у набережной", address: "", city: "Новосибирск", district: null, deal: "sale", propertyType: "office", price: 15000000, priceText: null, area: 100, floor: 1, rooms: null, images: [], description: "Офис с отдельным входом", phone: null, timestamp: "2026-11-05T10:00:00Z" });

it.each(["yandex", "onrealt", "mirkvartir"] as const)("preserves %s package address, district and title, treating blank as missing", source => {
  expect(normalizeListing({ ...raw(source), address: "  Новосибирск, ул. Тестовая, 1  ", district: " Центральный " })).toMatchObject({ address: "Новосибирск, ул. Тестовая, 1", district: "Центральный", title: "Офис у набережной" });
  expect(normalizeListing(raw(source)).address).toBeNull();
});
it("reads saved raw/normalized address without inventing geography from the title", () => {
  const saved = { address: "", raw: { normalized: { address: "ул. Тестовая, 2", district: "Центральный", title: "Офис" } } };
  expect(resultAddress(saved, { address: "" })).toBe("ул. Тестовая, 2");
  expect(listingFields({ title: "Торговля в Центральном" }).address).toBeNull();
  expect(resultAddress({}, { address: "  " })).toBe("Адрес не указан площадкой");
  expect(resultTitle(saved, {})).toBe("Офис");
  expect(resultTitle({}, {})).toBe("Заголовок не сохранён");
});
it("uses total sale price, keeps unitless rent under review and explains it", () => {
  const sale = normalizeListing(raw("yandex"));
  expect(sale.priceUnit).toBe("rub_total");
  expect(resultPriceUnit({ operation: "sale", priceUnit: null }, {})).toBe("за объект");
  const rent = normalizeListing({ ...raw("yandex"), deal: "rent" });
  expect(rent.priceUnit).toBeNull();
  expect(evaluateListing(rent, SearchFilters.parse({ operation: "rent", priceUnit: "rub_month" })).verdict).toBe("needs_review");
  expect(resultPriceUnit(rent, { priceUnit: "total" })).toBe("единица цены не указана");
  expect(resultPriceUnit({ operation: null, priceUnit: null }, { operation: "sale", priceUnit: "total" }, "rent")).toBe("единица цены не указана");
});
it("translates saved criterion states, sources, features and structured evidence", () => {
  for (const [group, value, label] of [["criterion_state", "unknown", "Нет данных"], ["criterion_source", "structured", "Структурированные поля"], ["criterion", "floor", "Этаж"], ["criterion", "power_from_50_kW", "Мощность от 50 кВт"]]) expect(evidenceLabel(group!, value!)).toBe(label);
  expect(translatedEvidence("separate_entrance=true; rub_total")).toBe("Отдельный вход=да; всего");
});
it("prefers the offer snapshot purpose and uses Russian property type only for missing legacy purpose", () => {
  const item = { addressSnapshot: "Адрес", areaSnapshot: null, priceSnapshot: null, termsSnapshot: "Назначение: Склад" };
  expect(offerCharacteristics(item, "office").purpose).toBe("Склад");
  expect(offerCharacteristics({ ...item, termsSnapshot: null }, "retail").purpose).toBe("Торговое помещение");
  expect(offerCharacteristics({ ...item, termsSnapshot: "Назначение: warehouse" }, "office").purpose).toBe("Склад");
});
