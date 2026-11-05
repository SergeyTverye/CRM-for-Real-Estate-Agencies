import {readFileSync,writeFileSync} from "node:fs";
import {evaluateListing} from "../../src/modules/property-search/domain/evaluation";
import {queries} from "./annotations";
import {SearchFilters,type NormalizedListing} from "../../src/modules/property-search/domain/types";
import {duplicateQualityGrouping} from "../../src/modules/listing-duplicates/domain/quality-adapter";

type Item={id:string;input:NormalizedListing;truth:{expected:string;reason:string;publicationDate:string|null}};
const data=JSON.parse(readFileSync("tests/fixtures/search-quality/live-v31-2026-11-05.json","utf8")) as {listings:Item[];duplicatePairs:{a:string;b:string;expected:string}[]};
const verdicts:Record<string,string>={C:"confirmed",N:"needs_review",R:"rejected"};
export function evaluateV31(){
 const totals={cases:0,falseInclusions:0,falseExclusions:0,falseConfirmed:0,exactVerdictErrors:0};
 const errors=[];
 for(const item of data.listings)for(const [index,q] of queries.entries()){
  const actual=evaluateListing(item.input,SearchFilters.parse(q.filters)).verdict;
  const expected=verdicts[item.truth.expected[index]!]!;totals.cases++;
  if(expected==="rejected"&&actual!=="rejected"){totals.falseInclusions++;if(actual==="confirmed")totals.falseConfirmed++;}
  if(expected!=="rejected"&&actual==="rejected")totals.falseExclusions++;
  if(expected!==actual){totals.exactVerdictErrors++;errors.push({id:item.id,query:q.id,expected,actual,url:item.input.url,reason:item.truth.reason});}
 }
 const predicted=duplicateQualityGrouping(data.listings.map(x=>({id:x.id,listing:x.input})));
 return {mode:"REPLAY",sourceMode:"LIVE",networkCalls:0,aiCalls:0,newUrls:data.listings.length,knownPublicationDates:data.listings.filter(x=>x.truth.publicationDate).length,totals,errors,duplicatePairs:data.duplicatePairs.map(p=>({...p,predicted:predicted.pairs.some(x=>[x.a,x.b].sort().join() ===[p.a,p.b].sort().join())}))};
}
export function runV31() {
 const result={before:JSON.parse(readFileSync("tests/fixtures/search-quality/baseline-v31.json","utf8")),after:evaluateV31()};
 writeFileSync("docs/vkr/search-quality-v31-metrics.json",JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result,null,2));
}
