import { readFileSync } from "node:fs";
import { beforeEach,expect,it } from "vitest";
import { db,resetDatabase,seedBase } from "../helpers/fixtures";

beforeEach(resetDatabase);
it.skipIf(process.env.CRM_DEPLOYMENT_MODE==="desktop")("PG period migration preserves demo-like search history and repairs only explicit snapshot null",async()=>{
  const users=await seedBase();
  const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters:{operation:"rent"},status:"success"}});
  const variants=[{key:"unknown",snapshot:{priceUnit:null}},{key:"known",snapshot:{priceUnit:"rub_total"}},{key:"missing",snapshot:{}},{key:"no-snapshot",snapshot:null}];
  const rows:{id:string}[]=[];
  for(const v of variants) {
    const row=await db.externalListing.create({data:{source:"onrealt",sourceListingId:`synthetic-${v.key}`,url:`https://onrealt.ru/${v.key}`,sourceMethod:"scraper",operation:"rent",priceRub:"80000",priceUnit:"total",areaM2:"80",description:"Синтетическое объявление"}});
    rows.push(row);
    await db.searchRunResult.create({data:{runId:run.id,listingId:row.id,verdict:"needs_review"}});
    if(v.snapshot) await db.externalListingSnapshot.create({data:{listingId:row.id,searchRunId:run.id,fetchedAt:new Date(),normalized:v.snapshot}});
  }
  const indexes=()=>db.$queryRawUnsafe("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='external_listings' ORDER BY indexname");
  const before=await indexes();
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('ALTER TABLE external_listings ALTER COLUMN price_unit SET NOT NULL');
    const sql=readFileSync("prisma/migrations/20261108210000_unknown_listing_price_period/migration.sql","utf8");
    for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  });
  expect(await indexes()).toEqual(before);
  const actual=await db.externalListing.findMany({orderBy:{sourceListingId:"asc"}});
  expect(actual.find(r=>r.id===rows[0]!.id)?.priceUnit).toBeNull();
  for(const row of rows.slice(1)) expect(actual.find(r=>r.id===row.id)?.priceUnit).toBe("total");
  expect(actual.every(r=>r.priceRub?.toString()==="80000"&&r.areaM2?.toString()==="80")).toBe(true);
  expect(await db.searchRunResult.count({where:{runId:run.id}})).toBe(4);
  expect(await db.externalListingSnapshot.count({where:{searchRunId:run.id}})).toBe(3);
  await db.externalListing.update({where:{id:rows[1]!.id},data:{priceUnit:null}});
  await expect(db.externalListing.delete({where:{id:rows[0]!.id}})).rejects.toThrow();
});
