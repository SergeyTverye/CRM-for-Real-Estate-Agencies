import { beforeEach, expect, it } from "vitest";
import replay from "../fixtures/youla-v323/detail-rent-flat.json";
import { db, resetDatabase, seedBase } from "../helpers/fixtures";
import { parseYoulaProduct } from "@/modules/property-search/infrastructure/youla-parser";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { persistListing } from "@/modules/property-search/application/search-service";
import { querySearchResults } from "@/modules/property-search/queries/results-query";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";

beforeEach(resetDatabase);
it("Youla residential REPLAY persists factual dates/area and unknown rent period with RBAC", async () => {
  const users = await seedBase();
  const filters = SearchFilters.parse({city:"Новосибирск",operation:"rent",priceUnit:"rub_month",purposes:["residential"],sources:["youla"]});
  const listing = normalizeListing(parseYoulaProduct(replay,"Новосибирск"));
  const run = await db.searchRun.create({data:{userId:users.realtor1.userId,filters,status:"completed"}});
  await db.$transaction(tx=>persistListing(tx,run.id,listing,evaluateListing(listing,filters),null));
  const result = await querySearchResults(users.realtor1,run.id);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.snapshot).toMatchObject({price:"34000.00",priceUnit:null,area:43,publishedAt:listing.publishedAt});
  const saved = await db.externalListing.findFirstOrThrow();
  expect(saved).toMatchObject({source:"youla",operation:"rent",priceUnit:null,pricePerM2Rub:null});
  await expect(querySearchResults(users.realtor2,run.id)).rejects.toMatchObject({status:404});
});
