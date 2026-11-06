/** Two authorized LIVE runs, no AI, no retry, and read-only snapshot comparison. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import RealEstateScraper from "real-estate-scrapper";
import { db, disconnectDb } from "@/shared/db/client";
import { createSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import { processSearchQueue } from "@/modules/property-search/application/search-queue";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { scraperHttpRequest } from "@/modules/property-search/infrastructure/scraper-http";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";

const base="http://127.0.0.1:3442";
const sources=["onrealt","yandex","mirkvartir"] as const;
const ledger: { url:string;status:number;sha256:string;at:string }[]=[];
const evidence: Record<string, unknown>={ mode:"LIVE", startedAt:new Date().toISOString(), maxSearchRuns:2, aiCalls:0, retries:0, ledger };
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname,"/crm_demo");
  assert.equal(process.env.AI_ENABLED,"false");
  assert.equal(await db.searchRun.count({where:{status:{in:["queued","running"]}}}),0,"Do not claim unrelated jobs");
  const user=await db.user.create({data:{login:`at0136_${randomBytes(5).toString("hex")}`,displayName:"[AT-01/03/06] временный испытатель",roleCode:"manager",passwordHash:"disabled-no-password-login",mustChangePassword:false}});
  const session=await createSession(db,user.id,{userAgent:"at0136-v31"});
  const cookie=`${SESSION_COOKIE}=${session.token}`;
  const runs:unknown[]=[];
  try {
    const scraper=new RealEstateScraperAdapter({enabled:true,enabledSources:[...sources],browserEnabled:false,jobTimeoutMs:150000,depth:{maxPages:1,limit:40},factory:async config=>{
      const {browser:ignored,jobDeadlineAt,...provided}=config; void ignored;
      const requested=new Set<string>(); let requests=0;
      const client=new RealEstateScraper({...provided,maxRetries:0,delay:0,transport:async request=>{
        assert(!requested.has(request.url),"No retry or duplicate physical request");requested.add(request.url);
        assert(++requests<=12,"Per-source request budget");
        const response=await scraperHttpRequest(request.url,{method:request.method as "GET"|"POST",headers:request.headers,signal:request.signal,timeoutMs:Math.min(request.timeout,30000),maxBytes:10000000,onResponse:response=>ledger.push({url:response.url,status:response.status,sha256:createHash("sha256").update(response.data).digest("hex"),at:new Date().toISOString()})});
        const text=response.data.toString("utf8");let data:unknown=text;
        if(/json/i.test(String(response.headers["content-type"]))) {try{data=JSON.parse(text);}catch{}}
        return {data,status:response.status,url:response.url,headers:{}};
      }});
      return extendSourceParsers(client,{deadline:jobDeadlineAt});
    }});
    for(const operation of ["rent","sale"] as const) {
      const filters=SearchFilters.parse({city:"Новосибирск",operation,priceUnit:operation==="rent"?"rub_month":"rub_total",purposes:["retail","office"],areaFrom:10,areaTo:2000,priceTo:operation==="rent"?"10000000":"1000000000",floorMode:"exclude_basement_and_semi_basement",features:{separate_entrance:true},sources:[...sources]});
      const response=await fetch(`${base}/api/v1/property-search/runs`,{method:"POST",headers:{cookie,origin:base,"content-type":"application/json"},body:JSON.stringify({filters,sources:[...sources],depth:{maxPages:1,limit:40},deadlineMs:180000,confirmedPaid:false,idempotencyKey:`at0136-${operation}-${user.id}`})});
      assert.equal(response.status,200);const run=await response.json() as {id:string};
      await processSearchQueue({scraper,workerId:"at0136-local-live"});
      const stored=await db.searchRun.findUniqueOrThrow({where:{id:run.id},include:{sources:true,results:{include:{listing:{select:{snapshots:{where:{searchRunId:run.id},select:{normalized:true}}}}}}}});
      assert(stored.finishedAt,"Must finish this one attempt; never retry failed LIVE runs");
      const rows=stored.results.map(row=>{
        const listing=row.listing.snapshots[0]!.normalized as unknown as NormalizedListing;
        const expected=evaluateListing(listing,filters,stored.startedAt);
        assert.equal(row.verdict,expected.verdict);
        return {url:listing.url,source:listing.source,purpose:listing.purpose,operation:listing.operation,city:listing.city,area:listing.area,price:listing.price,priceUnit:listing.priceUnit,floor:listing.floor,verdict:row.verdict,criteria:expected.criteria};
      });
      runs.push({runId:run.id,filters,status:stored.status,incompleteReason:stored.incompleteReason,sources:stored.sources,rows,positiveRetail:rows.filter(r=>r.purpose==="retail"&&r.verdict!=="rejected").length,counts:{confirmed:rows.filter(r=>r.verdict==="confirmed").length,needs_review:rows.filter(r=>r.verdict==="needs_review").length,rejected:rows.filter(r=>r.verdict==="rejected").length}});
      evidence.runs=runs;console.log(`${operation}: ${rows.length} results, retail accepted ${rows.filter(r=>r.purpose==="retail"&&r.verdict!=="rejected").length}`);
    }
    evidence.aiUsage=await db.aiUsageLog.count({where:{userId:user.id}});assert.equal(evidence.aiUsage,0);
    // Only recorded previousRunId pairs: comparable units, latest snapshot per run/listing.
    const pairs=await db.$queryRaw<{runId:string;previousRunId:string;listingId:string;url:string;oldPrice:string;newPrice:string;unit:string;priceChanged:boolean}[]>`
      SELECT r.run_id AS "runId",p.run_id AS "previousRunId",r.listing_id AS "listingId",l.url,
      old.price_rub::text AS "oldPrice",cur.price_rub::text AS "newPrice",cur.normalized->>'priceUnit' AS unit,r.price_changed AS "priceChanged"
      FROM search_run_results r JOIN search_runs run ON run.id=r.run_id JOIN external_listings l ON l.id=r.listing_id
      JOIN search_run_results p ON p.run_id=(run.depth_params->>'previousRunId')::uuid AND p.listing_id=r.listing_id
      JOIN LATERAL (SELECT * FROM external_listing_snapshots s WHERE s.search_run_id=r.run_id AND s.listing_id=r.listing_id ORDER BY fetched_at DESC,id ASC LIMIT 1) cur ON true
      JOIN LATERAL (SELECT * FROM external_listing_snapshots s WHERE s.search_run_id=p.run_id AND s.listing_id=p.listing_id ORDER BY fetched_at DESC,id ASC LIMIT 1) old ON true
      WHERE cur.price_rub IS NOT NULL AND old.price_rub IS NOT NULL AND cur.normalized->>'priceUnit'=old.normalized->>'priceUnit'
      AND l.source_listing_id NOT LIKE 'synthetic-%'`;
    evidence.snapshotComparison={mode:"REPLAY / read-only historical LIVE records",comparablePairs:pairs.length,changed:pairs.filter(p=>p.oldPrice!==p.newPrice),unchanged:pairs.filter(p=>p.oldPrice===p.newPrice).length};
    // Copy one real snapshot's public numeric facts for an isolated REPLAY test; no seller text/contact data.
    const sample=await db.externalListingSnapshot.findFirstOrThrow({where:{searchRunId:{in:(runs as {runId:string}[]).map(r=>r.runId)},priceRub:{not:null}},orderBy:{fetchedAt:"desc"}});
    const normalized=sample.normalized as unknown as NormalizedListing;
    const fixture={mode:"REPLAY",provenance:{sourceMode:"LIVE",snapshotId:sample.id,runId:sample.searchRunId,sourceUrl:normalized.url,sha256:createHash("sha256").update(JSON.stringify(sample.normalized)).digest("hex"),note:"Public numeric fields copied; description/seller/images removed. Changed price is synthetic."},listing:{...normalized,description:"",seller:{type:"unknown"},images:[],structuredFeatures:{},possibleDuplicateKeys:[]}};
    await writeFile("tests/fixtures/search-quality/price-change-v31-live.json",JSON.stringify(fixture,null,2)+"\n");
  } finally {
    await db.userSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
    await db.user.update({where:{id:user.id},data:{isActive:false}});
    evidence.cleanup={userInactive:true,activeSessions:await db.userSession.count({where:{userId:user.id,revokedAt:null}})};
    evidence.finishedAt=new Date().toISOString();
    await writeFile("docs/vkr/at0136-live-v31.json",JSON.stringify(evidence,null,2)+"\n");
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"LIVE failed");process.exitCode=1;}).finally(disconnectDb);
