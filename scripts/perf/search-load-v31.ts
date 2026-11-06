/** Isolated synthetic load only. Never resets a schema. Run prepare, then measure against next start. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release } from "node:os";
import ExcelJS from "exceljs";
import { db, disconnectDb } from "@/shared/db/client";
import { createSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import { SORTS } from "@/modules/property-search/queries/results-query";

const tag = "[PERF-v31]";
const count = Number(process.env.PERF_LISTINGS ?? 10000);
const base = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3441";
const output = process.env.PERF_OUTPUT ?? "docs/operations/perf-v31-results.json";
const anchor = new Date("2026-11-01T00:00:00Z");
const from = "2026-10-31T17:00:00.000Z", to = "2027-01-31T17:00:00.000Z";
const sources = ["onrealt", "yandex", "mirkvartir", "cian", "avito", "domclick", "youla"];
const units = ["rub_total", "rub_month", "rub_year", "rub_m2_month", "rub_m2_year"];
const verdicts = ["confirmed", "needs_review", "rejected"];
const date = (n: number) => new Date(+anchor - (n % 90) * 86400000);
const id = (n: number) => `a3100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const percentile = (xs: number[], p: number) => Math.round([...xs].sort((a,b) => a-b)[Math.ceil(xs.length*p)-1]! * 100)/100;
const summary = (xs: number[]) => ({ n: xs.length, p50: percentile(xs,.5), p95: percentile(xs,.95), max: Math.round(Math.max(...xs)*100)/100 });

async function prepare() {
  assert(count >= 5000 && count <= 10000);
  assert.equal(await db.externalListing.count(), 0, "Fixture exists; use measure, no destructive reset");
  const user = await db.user.create({ data: { login: `perf_v31_${randomBytes(5).toString("hex")}`, displayName: tag, roleCode: "manager", passwordHash: "disabled-no-password-login", mustChangePassword: false } });
  const run = await db.searchRun.create({ data: { userId: user.id, filters: { operation: "rent", purposes: ["retail", "office"] }, status: "completed", startedAt: anchor, finishedAt: anchor, fallbackReason: tag, incompleteReason: "Синтетическая сохранённая выборка; не весь рынок", progress: {} } });
  for (let start = 0; start < count; start += 250) {
    const numbers = Array.from({ length: Math.min(250,count-start) }, (_,n) => start+n);
    await db.externalListing.createMany({ data: numbers.map(n => ({ id: id(n), source: sources[n%7]!, sourceListingId: `perf-v31-${n}`, url: `https://example.org/perf-v31/${n}`, sourceMethod: "scraper", operation: n%5 ? "rent" : "sale", priceUnit: ["total", "per_month", "per_year", "per_m2_month", "per_m2_year"][n%5]!, priceRub: n%11 ? String((n%40+1)*10000) : null, areaM2: n%13 ? String((n%30+1)*10) : null, purposes: [n%2 ? "retail" : "office"], city: "Новосибирск", address: `${tag} улица Синтетическая, ${Math.floor(n/2)}`, firstSeenAt: date(n+3), lastSeenAt: anchor, lastCheckedAt: n%17 ? date(n+1) : null })) });
    await db.externalListingSnapshot.createMany({ data: numbers.map(n => ({ listingId: id(n), searchRunId: run.id, fetchedAt: anchor, publishedAt: n%7 ? date(n) : null, sourceUpdatedAt: n%9 ? date(n+2) : null, datePrecision: n%7 ? "day" : "unknown", dateSource: n%7 ? "site_published" : "unknown", priceRub: n%11 ? String((n%40+1)*10000) : null, pricePerM2Rub: n%11 && n%13 ? String((n%20+1)*100) : null, pricePerM2Unit: n%11 && n%13 ? (n%5 ? "per_m2_month" : "per_m2") : null, areaM2: n%13 ? String((n%30+1)*10) : null, normalized: { source: sources[n%7], url: `https://example.org/perf-v31/${n}`, purpose: n%2 ? "retail" : "office", operation: n%5 ? "rent" : "sale", price: n%11 ? String((n%40+1)*10000) : null, priceUnit: units[n%5], area: n%13 ? (n%30+1)*10 : null, address: `${tag} улица Синтетическая, ${Math.floor(n/2)}`, floor: { raw: "1", kind: "above_ground", number: 1 }, description: "Синтетическое помещение без контактов", images: [], seller: { type: "unknown" } } })) });
    await db.searchRunResult.createMany({ data: numbers.map(n => ({ runId: run.id, listingId: id(n), verdict: verdicts[n%3]!, score: n%10, priceChanged: n%19===0, isNew: n%4===0, criteria: [{ criterion: "separateEntrance", state: n%3===1 ? "unknown" : "matched", source: "structured", evidence: "synthetic" }] })) });
  }
  await db.searchRunSource.createMany({ data: sources.map((source,i) => ({ runId: run.id, source, status: "success", resultCount: Math.floor((count+6-i)/7), depthReached: 10, reason: "Синтетическая нагрузка, неполный охват рынка" })) });
  // Cross-source likely duplicates with explicit membership; no auto-confirmation.
  for (let n=0;n<40;n++) {
    const group = await db.listingDuplicateGroup.create({ data: { status: "probable", evidence: { synthetic: true } } });
    await db.listingDuplicateMember.createMany({ data: [n*2,n*2+1].map(index => ({ groupId: group.id, listingId: id(index) })) });
  }
  await db.task.createMany({ data: Array.from({ length: 3000 }, (_,n) => ({ responsibleUserId: user.id, createdBy: user.id, title: `${tag} ${n}`, taskType: "call_or_contact", status: n%5===0 ? "completed" : "planned", completedAt: n%5===0 ? anchor : null, priority: n%17===0 ? "critical" : "normal", dueAt: new Date(Date.parse(from) + (n%92)*86400000 + (n%24)*3600000) })) });
  await db.$executeRawUnsafe("ANALYZE");
  console.log(JSON.stringify({ prepared: true, listings: count, tasks: 3000, runId: run.id }));
}

async function measure() {
  const run = await db.searchRun.findFirstOrThrow({ where: { fallbackReason: tag } });
  const session = await createSession(db, run.userId, { userAgent: "perf-v31" });
  const cookie = `${SESSION_COOKIE}=${session.token}`;
  const measured: Record<string, unknown> = { mode: "SYNTHETIC / production HTTP", startedAt: new Date().toISOString(), base, hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: Math.round(totalmem()/2**30), os: `${platform()} ${release()}`, node: process.version }, runId: run.id };
  async function request(path: string, body?: unknown) {
    const started = performance.now();
    const response = await fetch(`${base}/api/v1${path}`, { method: body ? "POST" : "GET", headers: { cookie, origin: base, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const ms = performance.now()-started;
    assert.equal(response.status,200, `${path}: HTTP ${response.status} ${bytes.toString().slice(0,200)}`);
    return { bytes, ms };
  }
  const sorts: Record<string, unknown> = {};
  try {
    const total = await db.searchRunResult.count({ where: { runId: run.id } }); measured.listings = total;
    const expectedCounts = Object.fromEntries((await db.searchRunResult.groupBy({ by: ["verdict"], where: { runId: run.id }, _count: true })).map(r => [r.verdict,r._count]));
    const fields: Record<string,string> = { publication: "s.published_at", first_seen: "l.first_seen_at", source_updated: "s.source_updated_at", price: "s.price_rub", price_per_m2: "s.price_per_m2_rub", area: "s.area_m2", match: "CASE r.verdict WHEN 'confirmed' THEN 2 WHEN 'needs_review' THEN 1 ELSE 0 END", last_checked: "l.last_checked_at", price_change: "r.price_changed" };
    for (const sort of SORTS) for (const direction of ["asc","desc"] as const) {
      const unit = sort === "price" ? "s.normalized->>'priceUnit' ASC NULLS LAST," : sort === "price_per_m2" ? "s.price_per_m2_unit ASC NULLS LAST," : "";
      const expected = await db.$queryRawUnsafe<{ listingId: string }[]>(`SELECT r.listing_id AS "listingId" FROM search_run_results r JOIN external_listings l ON l.id=r.listing_id JOIN external_listing_snapshots s ON s.listing_id=l.id AND s.search_run_id=r.run_id WHERE r.run_id=$1::uuid ORDER BY ${unit} ${fields[sort]} ${direction} NULLS LAST, ${sort === "match" ? `r.score ${direction} NULLS LAST,` : ""} r.id ASC LIMIT 1000`,run.id);
      let revision = ""; const ids: string[] = [], times: number[] = [];
      for (let page=1;page<=20;page++) {
        const q = new URLSearchParams({ sort,direction,page:String(page),pageSize:"50",...(revision ? { revision } : {}) });
        const result = await request(`/property-search/runs/${run.id}/results?${q}`);
        const data = JSON.parse(result.bytes.toString());
        assert.equal(data.total,total); assert.deepEqual(data.counts,expectedCounts); assert.equal(data.incomplete,true);
        if (revision) assert.equal(data.revision,revision); revision = data.revision;
        ids.push(...data.rows.map((r: { listingId: string }) => r.listingId)); times.push(result.ms);
      }
      assert.equal(new Set(ids).size,1000); assert.deepEqual(ids,expected.map(r => r.listingId));
      const repeat = JSON.parse((await request(`/property-search/runs/${run.id}/results?sort=${sort}&direction=${direction}&pageSize=50`)).bytes.toString());
      assert.deepEqual(repeat.rows.map((r: { listingId: string }) => r.listingId),ids.slice(0,50));
      sorts[`${sort}.${direction}`] = { ...summary(times), pages:20, unique:1000, oracleOrder:true, counts:true, incomplete:true, idsSha256:createHash("sha256").update(ids.join(",")).digest("hex") };
      console.log(`${sort}.${direction}: p95=${percentile(times,.95)}ms`);
    }
    measured.sorts=sorts; measured.counts=expectedCounts;
    const tabs=[];
    for (const verdict of verdicts) {
      const result=await request(`/property-search/runs/${run.id}/results?verdict=${verdict}&pageSize=50`);
      const data=JSON.parse(result.bytes.toString());
      assert.equal(data.total,expectedCounts[verdict]);assert.deepEqual(data.counts,expectedCounts);
      assert(data.rows.every((row:{verdict:string})=>row.verdict===verdict));
      tabs.push({verdict,total:data.total,ms:Math.round(result.ms),countsUnchanged:true});
    }
    measured.tabs=tabs;
    const plannerTimes: number[]=[];
    for (let n=0;n<20;n++) {
      const r=await request(`/calendar/aggregate?${new URLSearchParams({ from,to,type:"task",employee:run.userId })}`);
      const data=JSON.parse(r.bytes.toString()); assert.equal(data.total,3000); assert(data.days.length<=93);
      assert.equal(data.days.reduce((s: number,d: {total: number})=>s+d.total,0),3000); plannerTimes.push(r.ms);
    }
    measured.planner={ ...summary(plannerTimes), tasks:3000, primaryRowsReturned:0 };
    const exports=[];
    const exportOrder=await db.$queryRaw<{url:string}[]>`SELECT l.url FROM search_run_results r JOIN external_listings l ON l.id=r.listing_id JOIN external_listing_snapshots s ON s.listing_id=l.id AND s.search_run_id=r.run_id WHERE r.run_id=${run.id}::uuid ORDER BY s.area_m2 ASC NULLS LAST,r.id ASC`;
    for (const format of ["csv","xlsx"]) {
      const r=await request(`/property-search/runs/${run.id}/export`,{ format, columns:["url","price","priceUnit","address"],query:{ sort:"area",direction:"asc" } });
      let urls:string[];
      if (format==="csv") urls=r.bytes.toString("utf8").replace(/^\uFEFF/,"").trim().split(/\r?\n/).slice(1).map(line=>line.split(";")[0]!.replaceAll('"',""));
      else { const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(r.bytes as never); urls=[]; workbook.worksheets[0]!.eachRow((row,n)=>{if(n>1) { const value=row.getCell(1).value; urls.push(typeof value==="object" && value && "hyperlink" in value ? String(value.hyperlink) : String(value)); }}); }
      assert.equal(urls.length,total); assert.equal(new Set(urls).size,total);
      assert.deepEqual(urls,exportOrder.map(row=>row.url));
      assert(urls.every(url=>/^https:\/\/example.org\/perf-v31\/\d+$/.test(url)));
      exports.push({ format, ms:Math.round(r.ms), rows:urls.length, unique: new Set(urls).size, oracleOrder:true, bytes:r.bytes.length, sha256:createHash("sha256").update(r.bytes).digest("hex") });
      console.log(`export.${format}: ${Math.round(r.ms)}ms, ${urls.length} rows`);
    }
    measured.exports=exports;
    measured.finishedAt=new Date().toISOString(); measured.status="PASS correctness; timings assessed separately";
  } finally {
    measured.sorts=sorts;
    await db.userSession.updateMany({ where:{userId:run.userId,userAgent:"perf-v31",revokedAt:null},data:{revokedAt:new Date()} });
    await writeFile(output,JSON.stringify(measured,null,2)+"\n");
  }
}
async function main() {
  const url=new URL(process.env.DATABASE_URL!);
  assert.equal(url.pathname,"/crm_load_v31","Only isolated crm_load_v31 permitted");
  assert(["localhost","127.0.0.1"].includes(url.hostname));
  if(process.argv[2]==="prepare") await prepare(); else if(process.argv[2]==="measure") await measure(); else throw Error("Use prepare or measure");
}
void main().catch(error=>{ console.error(error instanceof Error ? error.message : "Load failed");process.exitCode=1; }).finally(disconnectDb);
