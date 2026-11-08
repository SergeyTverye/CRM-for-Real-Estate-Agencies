ALTER TABLE "external_listings" ALTER COLUMN "price_unit" DROP NOT NULL;
ALTER TABLE "external_listings" DROP CONSTRAINT "external_listings_price_unit_check";
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_price_unit_check" CHECK ("price_unit" IS NULL OR "price_unit" IN ('total', 'per_month', 'per_m2', 'per_m2_month', 'per_year', 'per_m2_year'));
-- Repair only positively known null source periods, never infer from operation.
UPDATE external_listings l SET price_unit = NULL
WHERE (SELECT s.normalized->'priceUnit' FROM external_listing_snapshots s
       WHERE s.listing_id=l.id ORDER BY s.fetched_at DESC, s.id ASC LIMIT 1) = 'null'::jsonb;
