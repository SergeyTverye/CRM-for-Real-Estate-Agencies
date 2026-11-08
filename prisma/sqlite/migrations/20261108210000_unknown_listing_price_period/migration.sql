-- Rebuild safely both inside the desktop transaction and in Prisma deploy.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_external_listings" (
    "published_at" DATETIME,
    "source_updated_at" DATETIME,
    "date_source" TEXT NOT NULL DEFAULT 'unknown',
    "date_precision" TEXT NOT NULL DEFAULT 'unknown',
    "source_category_raw" TEXT,
    "purpose_evidence" JSONB,
    "price_per_m2_rub" BIGINT,
    "price_per_m2_unit" TEXT,
    "fetched_at" DATETIME,
    "last_checked_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "source_listing_id" TEXT,
    "source_unit_id" TEXT,
    "url" TEXT NOT NULL,
    "source_method" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "price_rub" BIGINT,
    "price_unit" TEXT,
    "area_m2" BIGINT,
    "floor_raw" TEXT,
    "floor_number" INTEGER,
    "purposes" JSONB NOT NULL DEFAULT '[]',
    "address" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "seller_type" TEXT,
    "owner_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "owner_confirmation_method" TEXT,
    "owner_confirmed_at" DATETIME,
    "owner_confirmation_source" TEXT,
    "description" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "first_seen_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "last_seen_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "last_price" BIGINT,
    "property_id" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "external_listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listings_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual')),
    CONSTRAINT "external_listings_source_method_check" CHECK ("source_method" IN ('scraper', 'web_search', 'manual')),
    CONSTRAINT "external_listings_operation_check" CHECK ("operation" IN ('sale', 'rent')),
    CONSTRAINT "external_listings_price_unit_check" CHECK ("price_unit" IS NULL OR "price_unit" IN ('total', 'per_month', 'per_m2', 'per_m2_month', 'per_year', 'per_m2_year')),
    CONSTRAINT "external_listings_values_check" CHECK (
  (price_rub IS NULL OR price_rub >= 0) AND (last_price IS NULL OR last_price >= 0)
  AND (area_m2 IS NULL OR area_m2 > 0) AND last_seen_at >= first_seen_at
  AND json_type(images) = 'array'
  AND (NOT owner_confirmed OR (owner_confirmed_at IS NOT NULL
    AND nullif(trim(owner_confirmation_method), '') IS NOT NULL
    AND nullif(trim(owner_confirmation_source), '') IS NOT NULL))),
    CONSTRAINT "external_listings_date_source_check" CHECK ("date_source" IN ('site_published', 'site_updated', 'relative_label', 'first_seen', 'unknown')),
    CONSTRAINT "external_listings_date_precision_check" CHECK ("date_precision" IN ('exact', 'day', 'relative', 'unknown')),
    CONSTRAINT "external_listings_price_per_m2_unit_check" CHECK ("price_per_m2_unit" IS NULL OR "price_per_m2_unit" IN ('per_m2', 'per_m2_month', 'per_m2_year')),
    CONSTRAINT "external_listings_price_per_m2_check" CHECK (("price_per_m2_rub" IS NULL AND "price_per_m2_unit" IS NULL) OR ("price_per_m2_rub" IS NOT NULL AND "price_per_m2_rub" >= 0 AND "price_per_m2_unit" IS NOT NULL)),
    CONSTRAINT "ExternalListing_pricePerM2Rub_exact" CHECK ("price_per_m2_rub" IS NULL OR (typeof("price_per_m2_rub") = 'integer' AND abs("price_per_m2_rub") < 10000000000000000)),
    CONSTRAINT "ExternalListing_priceRub_exact" CHECK ("price_rub" IS NULL OR (typeof("price_rub") = 'integer' AND abs("price_rub") < 10000000000000000)),
    CONSTRAINT "ExternalListing_areaM2_exact" CHECK ("area_m2" IS NULL OR (typeof("area_m2") = 'integer' AND abs("area_m2") < 1000000000000)),
    CONSTRAINT "ExternalListing_lastPrice_exact" CHECK ("last_price" IS NULL OR (typeof("last_price") = 'integer' AND abs("last_price") < 10000000000000000)),
    CONSTRAINT "ExternalListing_purposes_array" CHECK (json_valid("purposes") AND json_type("purposes") = 'array')
);
INSERT INTO "new_external_listings" ("published_at", "source_updated_at", "date_source", "date_precision", "source_category_raw", "purpose_evidence", "price_per_m2_rub", "price_per_m2_unit", "fetched_at", "last_checked_at", "id", "source", "source_listing_id", "source_unit_id", "url", "source_method", "operation", "price_rub", "price_unit", "area_m2", "floor_raw", "floor_number", "purposes", "address", "district", "city", "seller_type", "owner_confirmed", "owner_confirmation_method", "owner_confirmed_at", "owner_confirmation_source", "description", "images", "first_seen_at", "last_seen_at", "last_price", "property_id", "updated_at") SELECT "published_at", "source_updated_at", "date_source", "date_precision", "source_category_raw", "purpose_evidence", "price_per_m2_rub", "price_per_m2_unit", "fetched_at", "last_checked_at", "id", "source", "source_listing_id", "source_unit_id", "url", "source_method", "operation", "price_rub", "price_unit", "area_m2", "floor_raw", "floor_number", "purposes", "address", "district", "city", "seller_type", "owner_confirmed", "owner_confirmation_method", "owner_confirmed_at", "owner_confirmation_source", "description", "images", "first_seen_at", "last_seen_at", "last_price", "property_id", "updated_at" FROM "external_listings";
DROP TABLE "external_listings";
ALTER TABLE "new_external_listings" RENAME TO "external_listings";
CREATE INDEX "external_listings_published_at_id_idx" ON "external_listings"("published_at", "id");
CREATE INDEX "external_listings_source_updated_at_id_idx" ON "external_listings"("source_updated_at", "id");
CREATE INDEX "external_listings_first_seen_at_id_idx" ON "external_listings"("first_seen_at", "id");
CREATE INDEX "external_listings_price_rub_id_idx" ON "external_listings"("price_rub", "id");
CREATE INDEX "external_listings_price_per_m2_unit_price_per_m2_rub_id_idx" ON "external_listings"("price_per_m2_unit", "price_per_m2_rub", "id");
CREATE INDEX "external_listings_area_m2_id_idx" ON "external_listings"("area_m2", "id");
CREATE INDEX "external_listings_last_checked_at_id_idx" ON "external_listings"("last_checked_at", "id");
CREATE INDEX "external_listings_property_id_idx" ON "external_listings"("property_id");
CREATE INDEX "external_listings_city_operation_last_seen_at_idx" ON "external_listings"("city", "operation", "last_seen_at");
CREATE UNIQUE INDEX external_listings_source_identity_null_key ON external_listings(source,source_listing_id) WHERE source_listing_id IS NOT NULL AND source_unit_id IS NULL;
CREATE UNIQUE INDEX external_listings_source_identity_unit_key ON external_listings(source,source_listing_id,source_unit_id) WHERE source_listing_id IS NOT NULL AND source_unit_id IS NOT NULL;
UPDATE external_listings SET price_unit = NULL
WHERE (SELECT json_type(s.normalized, '$.priceUnit') FROM external_listing_snapshots s
       WHERE s.listing_id=external_listings.id ORDER BY s.fetched_at DESC,s.id ASC LIMIT 1) = 'null';
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
