import { beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "@/modules/auth/domain/actor";

const fixtures = vi.hoisted(() => ({
  property: vi.fn(), dictionary: vi.fn(), offer: vi.fn(), issuer: vi.fn(), media: vi.fn(), source: vi.fn(),
}));

// Keep this print-data regression synthetic: no DB client, media or environment initialization.
vi.mock("@/shared/db/client", () => ({ db: { property: { findUniqueOrThrow: fixtures.property }, dictionaryItem: { findUnique: fixtures.dictionary } } }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("@/modules/export/application/print-data", () => ({ getPrintIssuer: fixtures.issuer, getPropertySourceUrl: fixtures.source }));
vi.mock("@/modules/export/application/document-image", () => ({}));
vi.mock("@/modules/properties/application/property-media-service", () => ({ listPropertyMedia: fixtures.media }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ APP_TIMEZONE: "UTC" }) }));
vi.mock("@/shared/time", () => ({ formatDate: () => "01.01.2026" }));
vi.mock("@/modules/commercial-offers/application/offer-service", () => ({ getOffer: fixtures.offer }));
import { getOfferPrintData, offerCharacteristics } from "@/modules/commercial-offers/application/offer-print-data";
import { DICTIONARY_SEED } from "@/modules/dictionaries/domain/dictionary-data";

const item = { addressSnapshot: null, areaSnapshot: null, priceSnapshot: null, termsSnapshot: null };
beforeEach(() => vi.resetAllMocks());
it("labels canonical generic commercial purpose with the existing Russian dictionary label", () => {
  const purpose = offerCharacteristics(item, "commercial").purpose;
  expect(purpose).toBe("Коммерческая");
  expect(purpose).toBe(DICTIONARY_SEED.property_type.find(([code]) => code === "commercial")?.[1]);
});
it.each(["Офис на первом этаже", "Историческое назначение", "Авторское название из справочника"])("preserves frozen purpose %s over current generic type", purpose => {
  expect(offerCharacteristics({ ...item, termsSnapshot: `Назначение: ${purpose}` }, "commercial").purpose).toBe(purpose);
});
it("preserves existing display fallbacks, unknown text and missing-value behavior", () => {
  expect(offerCharacteristics(item, "retail").purpose).toBe("Торговое помещение");
  expect(offerCharacteristics(item, "Название из справочника").purpose).toBe("Название из справочника");
  expect(offerCharacteristics(item).purpose).toBe("Не указано");
  expect(offerCharacteristics({ ...item, termsSnapshot: "Назначение: commercial" }, "office").purpose).toBe("Коммерческая");
});

it.each(["Коммерческая (название предприятия)", null])("uses configured property type label or canonical fallback: %s", async label => {
  const actor: Actor = { userId: "synthetic", login: "synthetic", displayName: "Тест", role: "manager", mustChangePassword: false, sessionId: "synthetic" };
  fixtures.offer.mockResolvedValue({ offer: { id: "offer", legalEntityId: null, createdAt: new Date("2026-01-01Z"), responsible: { displayName: "Тест" }, items: [{ ...item, id: "item", propertyId: "property", position: 1 }] } });
  fixtures.issuer.mockResolvedValue(null); fixtures.media.mockResolvedValue([]); fixtures.source.mockResolvedValue(null);
  fixtures.property.mockResolvedValue({ propertyType: "commercial", commercialPurpose: null });
  fixtures.dictionary.mockResolvedValue(label ? { displayName: label } : null);
  const data = await getOfferPrintData(actor, "offer", "http://127.0.0.1:4273");
  expect(data.items[0]).toMatchObject({ purpose: label ?? "Коммерческая", propertyUrl: "http://127.0.0.1:4273/properties/property" });
  expect(fixtures.dictionary).toHaveBeenCalledWith({ where: { category_code: { category: "property_type", code: "commercial" } }, select: { displayName: true } });
});
