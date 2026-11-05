import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { setBookmark, deleteBookmark, listBookmarks, setSelection, listSelections, saveSearch, listSavedSearches, proposeListing, listingToOffer } from "@/modules/property-search/application/listing-service";
import { runSearch, getSearchRun, exportSearchCsv } from "@/modules/property-search/application/search-service";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { POST as selectionApi } from "@/app/api/v1/property-search/listings/[id]/selection/route";
import { resetConfigCache } from "@/shared/config/env";

let users: TestUsers;
const filters = SearchFilters.parse({operation:"sale"});
beforeEach(async () => { await resetDatabase(); users = await seedBase(); process.env.AI_ENABLED="false"; resetConfigCache(); });
async function setup() {
  const client = await makeClient(users.realtor1); const need = await makeNeed(users.realtor1,client.id);
  const listing = await db.externalListing.create({data:{source:"cian",sourceListingId:"synthetic",url:"https://cian.ru/synthetic",sourceMethod:"scraper",operation:"sale",priceUnit:"total",address:"Синтетическая, 1"}});
  return {need:{...need,clientId:client.id},listing};
}
describe("property search authorization",()=>{
  it("foreign need denied for candidate/proposal/offer/saved-search and run",async()=>{
    const {need,listing} = await setup();
    for (const call of [
      ()=>setSelection(users.realtor2,listing.id,{needId:need.id}),
      ()=>listSelections(users.realtor2,need.id),
      ()=>proposeListing(users.realtor2,listing.id,{needId:need.id}),
      ()=>listingToOffer(users.realtor2,listing.id,{needId:need.id}),
      ()=>saveSearch(users.realtor2,{name:"Чужая",filters,sources:["cian"],needId:need.id}),
      ()=>runSearch(users.realtor2,{filters,sources:["cian"],needId:need.id}),
    ]) await expect(call()).rejects.toMatchObject({status:404});
    expect(await db.searchSelection.count()).toBe(0); expect(await db.savedSearch.count()).toBe(0); expect(await db.searchRun.count()).toBe(0);
  });
  it("direct API denies foreign need without leaking client",async()=>{
    const {need,listing} = await setup();
    const cookie = await sessionCookieFor(users.realtor2);
    const response = await selectionApi(apiRequest("POST",`/api/v1/property-search/listings/${listing.id}/selection`,{cookie,body:{needId:need.id}}),routeParams({id:listing.id}));
    expect(response.status).toBe(404); const body = await response.text(); expect(body).not.toContain(need.clientId);
  });
  it("bookmarks are personal even for manager",async()=>{
    const {listing} = await setup();
    const bookmark = await setBookmark(users.realtor1,listing.id,{status:"study",note:"Личная заметка"});
    expect(await listBookmarks(users.realtor2)).toEqual([]); expect(await listBookmarks(users.manager)).toEqual([]);
    await expect(deleteBookmark(users.realtor2,bookmark.id)).rejects.toMatchObject({status:404});
    await setBookmark(users.realtor2,listing.id,{status:"exclude",note:"Другая заметка"});
    expect((await listBookmarks(users.realtor1))[0]!.note).toBe("Личная заметка");
  });
  it("saved need rights rechecked after responsibility transfer",async()=>{
    const {need} = await setup();
    const saved = await saveSearch(users.realtor1,{name:"Личный",filters,sources:[],needId:need.id});
    await db.client.update({where:{id:need.clientId},data:{responsibleUserId:users.realtor2.userId}});
    await db.clientNeed.update({where:{id:need.id},data:{responsibleUserId:users.realtor2.userId}});
    expect(await listSavedSearches(users.realtor1)).toEqual([]);
    const scraper = {search:vi.fn()};
    await expect(runSearch(users.realtor1,{filters,sources:[],savedSearchId:saved.id},{scraper})).rejects.toMatchObject({status:404});
    expect(scraper.search).not.toHaveBeenCalled();
  });
  it("run/export is private and rechecks linked need",async()=>{
    const {need} = await setup();
    const run = await runSearch(users.realtor1,{filters,sources:[],needId:need.id},{scraper:{search:async()=>({sources:[],listings:[]})}});
    await expect(getSearchRun(users.realtor2,run.id)).rejects.toMatchObject({status:404});
    await expect(exportSearchCsv(users.realtor2,run.id)).rejects.toMatchObject({status:404});
    await db.client.update({where:{id:need.clientId},data:{responsibleUserId:users.realtor2.userId}});
    await db.clientNeed.update({where:{id:need.id},data:{responsibleUserId:users.realtor2.userId}});
    await expect(getSearchRun(users.realtor1,run.id)).rejects.toMatchObject({status:404});
  });
});
