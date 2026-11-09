import { enrichListingQuality } from "@/modules/property-search/infrastructure/listing-quality";
import { beforeEach, expect, it } from "vitest";
import fixture from "../fixtures/search-quality/price-change-v31-live.json";
import { db, resetDatabase, seedBase } from "../helpers/fixtures";
import { Prisma } from "@/shared/db/client";
import { persistListing } from "@/modules/property-search/application/search-service";
import { querySearchResults, resultQuerySchema } from "@/modules/property-search/queries/results-query";
import { exportSearch } from "@/modules/property-search/application/export-service";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";

beforeEach(resetDatabase);
it("REPLAY real public snapshot: unchanged / changed / incompatible unit, preserving original snapshot", async () => {
  const users=await seedBase();
  const listing=structuredClone(fixture.listing) as NormalizedListing;
  const original=structuredClone(listing);
  const filters=SearchFilters.parse({ operation:"sale",purposes:["retail"] });
  const launch=async (value:NormalizedListing,previous:string|null) => {
    const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters,status:"completed",startedAt:new Date(value.fetchedAt),finishedAt:new Date(value.fetchedAt)}});
    await db.$transaction(tx=>persistListing(tx,run.id,value,evaluateListing(value,filters),previous));
    return run;
  };
  const first=await launch(listing,null);
  const unchanged=await launch({...listing,fetchedAt:new Date(Date.parse(listing.fetchedAt)+1000).toISOString()},first.id);
  const price=dbDecimalAdd(listing.price!);
  const changed=await launch({...listing,price,fetchedAt:new Date(Date.parse(listing.fetchedAt)+2000).toISOString()},unchanged.id);
  const incompatible=await launch({...listing,price,operation:"rent",priceUnit:"rub_month",fetchedAt:new Date(Date.parse(listing.fetchedAt)+3000).toISOString()},changed.id);
  expect((await querySearchResults(users.realtor1,first.id)).rows[0]).toMatchObject({isNew:true,priceChanged:false});
  expect((await querySearchResults(users.realtor1,unchanged.id)).rows[0]).toMatchObject({isNew:false,priceChanged:false});
  expect((await querySearchResults(users.realtor1,changed.id)).rows[0]).toMatchObject({isNew:false,priceChanged:true,snapshot:expect.objectContaining({price})});
  expect((await querySearchResults(users.realtor1,incompatible.id)).rows[0]).toMatchObject({isNew:false,priceChanged:false});
  expect((await db.externalListingSnapshot.findFirstOrThrow({where:{searchRunId:first.id}})).priceRub?.toFixed(2)).toBe(listing.price);
  expect(listing).toEqual(original);
  expect(await db.externalListingSnapshot.count()).toBe(4);
  await expect(querySearchResults(users.realtor2,changed.id)).rejects.toMatchObject({status:404});
});

const dbDecimalAdd=(price:string)=>new Prisma.Decimal(price).add("100000").toFixed(2);

it("internal export crosses 2000 rows, public pagination stays capped and foreign export stays denied", async () => {
  const users=await seedBase();
  const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters:{operation:"sale"},status:"completed"}});
  const { randomUUID }=await import("node:crypto");
  const ids=Array.from({length:2005},()=>randomUUID());
  await db.externalListing.createMany({data:ids.map((id,n)=>({id,source:"mirkvartir",sourceListingId:`export-batch-${n}`,url:`https://example.org/${n}`,sourceMethod:"scraper",operation:"sale",priceUnit:"total"}))});
  await db.searchRunResult.createMany({data:ids.map(listingId=>({runId:run.id,listingId,verdict:"needs_review"}))});
  expect(resultQuerySchema.safeParse({pageSize:2000}).success).toBe(false);
  await expect(querySearchResults(users.realtor1,run.id,{pageSize:2000})).rejects.toMatchObject({status:400});
  const exported=await exportSearch(users.realtor1,run.id,{columns:["url"]});
  const urls=Buffer.from(exported.bytes).toString().trim().split("\r\n").slice(1);
  expect(urls).toHaveLength(2005);expect(new Set(urls).size).toBe(2005);
  await expect(exportSearch(users.realtor2,run.id,{})).rejects.toMatchObject({status:404});
  expect((await db.searchExport.findUniqueOrThrow({where:{id:exported.exportId}})).rowCount).toBe(2005);
  const extra=Array.from({length:7996},()=>randomUUID());
  await db.externalListing.createMany({data:extra.map((id,n)=>({id,source:"mirkvartir",sourceListingId:`limit-${n}`,url:`https://example.org/limit/${n}`,sourceMethod:"scraper",operation:"sale",priceUnit:"total"}))});
  await db.searchRunResult.createMany({data:extra.map(listingId=>({runId:run.id,listingId,verdict:"needs_review"}))});
  await expect(exportSearch(users.realtor1,run.id,{columns:["url"]})).rejects.toMatchObject({code:"EXPORT_LIMIT"});
  expect(await db.searchExport.count()).toBe(1);
});

it("AI-02 persists a genuinely unknown period and never signals comparable price changes",async()=>{
  const users=await seedBase(),filters=SearchFilters.parse({operation:"sale"});
  let previous:string|null=null;
  for(const price of ["80000","50000"]) {
    const listing={...structuredClone(fixture.listing),price,priceUnit:null} as NormalizedListing;
    const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters,status:"success"}});
    await db.$transaction(tx=>persistListing(tx,run.id,listing,evaluateListing(listing,filters),previous));
    const row=await db.externalListing.findFirstOrThrow();
    expect(row.priceUnit).toBeNull();expect(row.pricePerM2Rub).toBeNull();
    expect((await db.searchRunResult.findFirstOrThrow({where:{runId:run.id}})).priceChanged).toBe(false);
    previous=run.id;
  }
});

it("v323 JSON conditions and daily/room snapshot survive persistence and repeat on both backends",async()=>{
 const users=await seedBase();
 const filters=SearchFilters.parse({operation:"rent",priceUnit:"rub_month",propertyKinds:["flat"],rooms:["2"],locations:["berdsk"]});
 const saved=await db.savedSearch.create({data:{ownerUserId:users.realtor1.userId,name:"Синтетический поиск комнат",filters,sources:["onrealt"]}});
 expect(SearchFilters.parse((await db.savedSearch.findUniqueOrThrow({where:{id:saved.id}})).filters).rooms).toEqual(["2"]);
 const daily=enrichListingQuality({...structuredClone(fixture.listing),operation:"rent",priceUnit:null,rooms:2,title:"2-к. квартира",city:"Бердск",description:"Сдаётся посуточно за сутки",structuredFeatures:{}} as NormalizedListing);
 for(let index=0;index<2;index++) {
  const run=await db.searchRun.create({data:{userId:users.realtor1.userId,savedSearchId:saved.id,filters,status:"completed"}});
  await db.$transaction(tx=>persistListing(tx,run.id,daily,evaluateListing(daily,filters),null));
  const result=await querySearchResults(users.realtor1,run.id,{verdict:"rejected"});
  expect(result.total).toBe(1);expect(result.rows[0]?.snapshot).toMatchObject({rooms:2,priceUnit:null,structuredFeatures:{rentalPeriod:"day"}});
  expect(result.rows[0]?.criteria).toEqual(expect.arrayContaining([expect.objectContaining({criterion:"rentalPeriod",state:"contradicted"})]));
  await expect(querySearchResults(users.realtor2,run.id)).rejects.toMatchObject({status:404});
 }
});
