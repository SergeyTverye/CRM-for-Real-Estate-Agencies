import { expect,it } from "vitest";
import fixture from "../../fixtures/search-quality/price-change-v31-live.json";
import { resultPriceUnit } from "@/app/(crm)/property-search/result-display";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters,type NormalizedListing } from "@/modules/property-search/domain/types";

it.each(["sale","rent"])("unknown period is visible for %s, including legacy default total", operation=>{
  expect(resultPriceUnit({operation,priceUnit:null},{operation,priceUnit:"total"})).toBe("период не указан");
  expect(resultPriceUnit(null,{operation,priceUnit:null})).toBe("период не указан");
});
it("known sale/monthly units retain their labels",()=>{
  expect(resultPriceUnit({operation:"sale",priceUnit:"rub_total"},{})).toBe("за объект");
  expect(resultPriceUnit({operation:"rent",priceUnit:"rub_month"},{})).toBe("в месяц");
});
it("zero match score means no preferences, not an AI ranking failure",()=>{
  const listing={...fixture.listing,structuredFeatures:{parking:true}} as NormalizedListing;
  expect(evaluateListing(listing,SearchFilters.parse({operation:"sale"})).score).toBe(0);
  expect(evaluateListing(listing,SearchFilters.parse({operation:"sale",preferredFeatures:["парковка"]})).score).toBe(100);
});
it("unknown price period never satisfies a budget",()=>{
  const listing={...fixture.listing,priceUnit:null} as NormalizedListing;
  const result=evaluateListing(listing,SearchFilters.parse({operation:"sale",priceTo:"9000000"}));
  expect(result.criteria.filter(c=>["price","priceUnit"].includes(c.criterion)).map(c=>c.state)).toEqual(["unknown","unknown"]);
});
