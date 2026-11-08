import { expect, it } from "vitest";
import { decodeParseResult, providerParseInstructions, providerParseSchema } from "@/modules/ai/domain/provider-parse";
import { preserveSearchConditions } from "@/modules/ai/domain/listing-analysis";
import { SearchFilters } from "@/modules/property-search/domain/types";
it.each([["Двушка в Бердске до 5 млн","2"],["Однушка в Бердске","1"],["Студия в Бердске","studio"],["Трёшка в Бердске","3"]])("REPLAY provider: %s", (query,room) => {
  expect(providerParseSchema.required).toContain("rooms");
  expect(providerParseInstructions).toContain("однушка");
  const proposed=decodeParseResult(JSON.stringify({filters:{operation:"sale",propertyKinds:["flat"],rooms:[room],locations:["berdsk"],priceTo:"5000000"},clarificationQuestion:null})).filters!;
  const before=SearchFilters.parse({operation:"sale",hasPhotos:true});
  const next=preserveSearchConditions(before,proposed,query);
  expect(next.rooms).toEqual([room]);expect(next.propertyKinds).toEqual(["flat"]);expect(next.hasPhotos).toBe(true);
});
it("unrelated budget refinement preserves rooms; explicit any rooms removes them", () => {
  const before=SearchFilters.parse({operation:"sale",rooms:["2"]});
  const proposed=SearchFilters.parse({operation:"sale",priceTo:"6000000"});
  expect(preserveSearchConditions(before,proposed,"До 6 млн").rooms).toEqual(["2"]);
  expect(preserveSearchConditions(before,proposed,"Любое число комнат").rooms).toBeUndefined();
});
