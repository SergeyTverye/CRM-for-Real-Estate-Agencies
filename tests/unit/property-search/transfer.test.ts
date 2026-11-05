import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const listing = { id: "11111111-1111-4111-8111-111111111111", propertyId: null, source: "cian", sourceMethod: "scraper",
    sourceListingId: "source-id", sourceUnitId: "unit-1", url: "https://cian.ru/offer", address: "Synthetic address" };
  const tx = { $executeRaw: vi.fn(), externalListing: { findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    externalListingSnapshot: { findFirst: vi.fn() }, searchSelection: { updateMany: vi.fn() }, property: { create: vi.fn() } };
  return { listing, tx, audit: vi.fn() };
});
vi.mock("@/shared/db/client", async importOriginal => ({ ...await importOriginal<typeof import("@/shared/db/client")>(),
  db: { externalListing: { findUnique: async () => state.listing } }, transaction: async (work: (tx: typeof state.tx) => unknown) => work(state.tx) }));
vi.mock("@/shared/net/ssrf", () => ({ guardExternalUrl: vi.fn() }));
vi.mock("@/modules/property-search/application/search-service", () => ({ searchAudit: state.audit, jsonValue: (value: unknown) => value }));

import { transferToCatalog } from "@/modules/property-search/application/listing-service";
import type { Actor } from "@/modules/auth/domain/actor";
const actor = { userId: "22222222-2222-4222-8222-222222222222", role: "realtor" } as Actor;

describe("catalog provenance reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tx.externalListing.findUniqueOrThrow.mockResolvedValue(state.listing);
    state.tx.externalListingSnapshot.findFirst.mockResolvedValue(null);
    state.tx.externalListing.findFirst.mockResolvedValue({ propertyId: "existing-property" });
  });
  it("reuses the Property from another listing with identical source/listing/unit keys", async () => {
    expect(await transferToCatalog(actor, state.listing.id, { confirmed: true })).toEqual({ id: "existing-property", created: false });
    expect(state.tx.$executeRaw.mock.calls[0]![0].join("?")).toContain("FOR UPDATE");
    expect(state.tx.$executeRaw.mock.calls[1]![0].join("?")).toContain("pg_advisory_xact_lock");
    expect(state.tx.externalListing.findFirst).toHaveBeenCalledWith({ where: {
      source: "cian", sourceListingId: "source-id", sourceUnitId: "unit-1", propertyId: { not: null },
    }, select: { propertyId: true } });
    expect(state.tx.property.create).not.toHaveBeenCalled();
    expect(state.tx.externalListing.update).toHaveBeenCalledWith({ where: { id: state.listing.id }, data: { propertyId: "existing-property" } });
    expect(state.tx.searchSelection.updateMany).toHaveBeenCalledWith({ where: { listingId: state.listing.id }, data: { propertyId: "existing-property" } });
    expect(state.audit).toHaveBeenCalledWith(state.tx, actor, "transferred", "ExternalListing", state.listing.id, expect.objectContaining({ reused: true }));
  });
});
