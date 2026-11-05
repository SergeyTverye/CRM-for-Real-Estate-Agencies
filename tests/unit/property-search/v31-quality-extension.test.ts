import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {evaluateV31} from "../../../scripts/search-quality/evaluate-v31";
import original from "../../fixtures/search-quality/live-2026-11-05.json";
import baseline from "../../fixtures/search-quality/baseline-v31.json";

describe("v3.1 independently labelled live extension",()=>{
 it("retains 20 genuinely new public URLs with original date provenance and no contacts",()=>{
  const d=JSON.parse(readFileSync("tests/fixtures/search-quality/live-v31-2026-11-05.json","utf8")) as {listings:{input:{url:string;description:string;publishedAt:string|null;seller:unknown};provenance:{searchRunId:string}}[]};
  const old=new Set(original.listings.map(x=>x.input.url));
  expect(d.listings).toHaveLength(20);expect(new Set(d.listings.map(x=>x.input.url)).size).toBe(20);
  for(const row of d.listings){expect(old.has(row.input.url)).toBe(false);expect(row.input.url).not.toMatch(/synthetic|example/);expect(row.provenance.searchRunId).toBeTruthy();expect(row.input.seller).toEqual({type:"unknown"});expect(row.input.description).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/iu);}
  expect(d.listings.filter(x=>x.input.publishedAt)).toHaveLength(8);
 });
 it("does not hide new inclusion/exclusion errors by changing old thresholds",()=>{
  const current=evaluateV31();
  expect(current.totals.cases).toBe(80);
  for(const key of ["falseInclusions","falseExclusions","falseConfirmed","exactVerdictErrors"] as const)expect(current.totals[key]).toBeLessThanOrEqual(baseline.totals[key]);
  expect(current.duplicatePairs.every(x=>!x.predicted)).toBe(true);
 });
});
