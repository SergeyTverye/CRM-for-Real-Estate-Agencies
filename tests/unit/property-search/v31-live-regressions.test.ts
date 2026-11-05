import { describe, it, expect } from "vitest";
import { describedUndergroundFloor } from "@/modules/property-search/domain/floor";
import { evaluateListing, evaluateFeature } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";

const listing: NormalizedListing = {source:"onrealt",sourceListingId:"86528882",sourceUnitId:null,url:"https://onrealt.ru/novosibirsk/kypit-ofis/86528882",purpose:"office",operation:"sale",price:"12500000.00",priceUnit:"rub_total",area:145.1,floor:{kind:"above_ground",number:1,raw:"1"},city:"Новосибирск",address:null,district:null,seller:{type:"unknown"},description:"Продаётся коммерческое помещение цокольный этаж, 145,1 м².",images:[],fetchedAt:"2026-11-05T22:14:00Z",structuredFeatures:{},possibleDuplicateKeys:[],identityNeedsReview:false};
describe("LIVE v3.1 explicit underground floor contradicts source first-floor field",()=>{
  it.each(["first_floor_only","exclude_basement_and_semi_basement"] as const)("rejects %s without mutating historical snapshot",floorMode=>{
    expect(evaluateListing(listing,SearchFilters.parse({operation:"sale",floorMode})).verdict).toBe("rejected");
    expect(listing.floor.number).toBe(1);
  });
  it("keeps unrestricted commercial search",()=>{
    expect(evaluateListing(listing,SearchFilters.parse({operation:"sale"})).verdict).toBe("confirmed");
  });
  it.each(["Помещение без подвала и цоколя.","Помещение не на цокольном этаже.","В здании есть цокольный этаж.","На первом этаже, рядом вход в подвал.","Есть подвал для хранения."])("does not invent a contradiction: %s",text=>{
    expect(describedUndergroundFloor(text)).toBeNull();
  });
  it("does not read небоскрёб as the negation не",()=>{
    expect(evaluateFeature("отдельный вход",{...listing,description:"Торговая площадь в небоскрёбе Тихомиров — отдельный вход, потолки 4 м."}).state).toBe("matched");
    expect(evaluateFeature("отдельный вход",{...listing,description:"Помещение без отдельного входа."}).state).toBe("contradicted");
  });
  it("uses explicit rent only when the operation is missing, leaving ambiguous offers unknown",()=>{
    const filters=SearchFilters.parse({operation:"sale"});
    expect(evaluateListing({...listing,operation:null,description:"В аренду предлагается торговое помещение"},filters).verdict).toBe("rejected");
    expect(evaluateListing({...listing,operation:null,description:"Продажа или аренда помещения"},filters).criteria.find(c=>c.criterion==="operation")?.state).toBe("unknown");
  });
});
