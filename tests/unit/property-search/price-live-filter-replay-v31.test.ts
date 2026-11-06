import { expect, it } from "vitest";
import fixture from "../../fixtures/search-quality/price-change-v31-live.json";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";

it("REPLAY retail snapshot satisfies either selected purpose; other conditions remain AND and unknown stays review",()=>{
  const listing=structuredClone(fixture.listing) as NormalizedListing;
  const filters=SearchFilters.parse({operation:"sale",purposes:["retail","office"],areaFrom:50,areaTo:100,features:{separate_entrance:true}});
  const result=evaluateListing(listing,filters);
  expect(result.verdict).toBe("needs_review");
  expect(result.criteria).toContainEqual(expect.objectContaining({criterion:"purpose",state:"matched"}));
  expect(result.criteria).toContainEqual(expect.objectContaining({criterion:"features.separate_entrance",state:"unknown"}));
  expect(evaluateListing(listing,{...filters,purposes:["office"]}).verdict).toBe("rejected");
  expect(evaluateListing(listing,{...filters,areaTo:60}).verdict).toBe("rejected");
  expect(evaluateListing(listing,{...filters,operation:"rent",priceUnit:"rub_month"}).verdict).toBe("rejected");
});
