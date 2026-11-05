import { expect,it } from "vitest";
import { analysisCacheKey,filterDiff,forbiddenAnalysisCriterion,preserveSearchConditions,safeListingText } from "@/modules/ai/domain/listing-analysis";
import { SearchFilters } from "@/modules/property-search/domain/types";
it("cache fingerprint is order-independent but changes with description, criteria or model",()=>{
  const key=analysisCacheKey("описание",["a","b"],"m");
  expect(analysisCacheKey("описание",["b","a","a"],"m")).toBe(key);
  for(const other of [analysisCacheKey("новое",["a","b"],"m"),analysisCacheKey("описание",["a"],"m"),analysisCacheKey("описание",["a","b"],"m2")]) expect(other).not.toBe(key);
});
it("clarifications preserve unrelated mandatory conditions and expose diff",()=>{
  const before=SearchFilters.parse({operation:"sale",floorMode:"first_floor_only",priceTo:"9000000",districts:["Центральный"],areaFrom:80,requiredFeatures:["витрина"]});
  const proposed=SearchFilters.parse({operation:"sale",requiredFeatures:["отдельный вход"]});
  const after=preserveSearchConditions(before,proposed,"добавь отдельный вход, остальные условия сохрани");
  expect(after).toMatchObject({floorMode:"first_floor_only",priceTo:"9000000",districts:["Центральный"],areaFrom:80,requiredFeatures:["витрина","отдельный вход"]});
  expect(filterDiff(before,after).map(d=>d.field)).toEqual(["requiredFeatures"]);
});
it("explicit reset and explicit budget changes are applied",()=>{
  const before=SearchFilters.parse({operation:"sale",priceTo:"9000000",areaFrom:80});
  const proposed=SearchFilters.parse({operation:"sale",priceTo:"7000000"});
  expect(preserveSearchConditions(before,proposed,"бюджет 7000000 рублей")).toMatchObject({priceTo:"7000000",areaFrom:80});
  expect(preserveSearchConditions(before,proposed,"начни заново")).toEqual(proposed);
});
it("removing a named feature preserves the remaining mandatory features",()=>{
  const before=SearchFilters.parse({operation:"sale",requiredFeatures:["парковка","отдельный вход"],features:{parking:true,separate_entrance:true}});
  const proposed=SearchFilters.parse({operation:"sale"});
  const next=preserveSearchConditions(before,proposed,"убери требование парковки");
  expect(next.requiredFeatures).toEqual(["отдельный вход"]);expect(next.features).toEqual({separate_entrance:true});
});
it("sensitive public text is redacted and ownership/availability cannot be AI verified",()=>{
  expect(safeListingText("+7 900 123-45-67; a@example.ru; паспорт 1234 567890; площадь 80 м²")).not.toMatch(/900|example|1234/);
  for(const c of ["owner","availability","Собственник","актуальная доступность","свободно"]) expect(forbiddenAnalysisCriterion(c)).toBe(true);
});
