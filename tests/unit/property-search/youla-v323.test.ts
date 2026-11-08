import { describe, expect, it, vi } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { readFileSync } from "node:fs";
import { attachYoulaParser, parseYoulaFeed, parseYoulaProduct, youlaState } from "@/modules/property-search/infrastructure/youla-parser";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { RealEstateScraperAdapter } from "@/modules/property-search/infrastructure/scraper-adapter";
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/youla-v323/${name}.json`, "utf8"));
const cityId = "576d0616d53f3d80945f93b6";
const url = "https://youla.ru/novosibirsk/nedvijimost/prodaja-kvartiri";
const q: RealEstateScraper.Query = { city: "Новосибирск", category: "residential", type: "flat", deal: "sale", sourceOptions: { youla: { cityId } } };
function client(maxCards = 0) {
  const transport = vi.fn<RealEstateScraper.Transport>(async () => ({ data: fixture("flat") }));
  const scraper = new RealEstateScraper({ transport, delay: 0, maxRetries: 0 });
  attachYoulaParser(scraper, { maxCards, minRequestIntervalMs: 0 });
  return { scraper, parser: scraper.parsers.youla, transport };
}
describe("Youla v323 REPLAY / sanitized LIVE shapes", () => {
  it.each([['flat','sale','prodaja-kvartiri'],['flat','rent','arenda-kvartiri'],['room','sale','prodaja-komnati'],['room','rent','arenda-komnati'],['house','sale','prodaja-doma'],['house','rent','arenda-doma']] as const)("builds %s %s category %s", (type, deal, slug) => {
    expect(new URL(client().parser.buildSearchUrl({ ...q, type, deal })).pathname).toBe(`/novosibirsk/nedvijimost/${slug}`);
  });
  it("encodes studio/rooms, area and price with verified scale", () => {
    const { parser } = client();
    const u = new URL(parser.buildSearchUrl({ ...q, rooms: [1,2], areaMin: 43.5, priceMax: 50000 }));
    expect(u.searchParams.get('attributes[komnat_v_kvartire][1]')).toBe('10655');
    expect(u.searchParams.get('attributes[realty_obshaya_ploshad][from]')).toBe('4350');
    expect(u.searchParams.get('attributes[price][to]')).toBe('5000000');
    expect(new URL(parser.buildSearchUrl({ ...q, type: 'studio' })).searchParams.get('attributes[komnat_v_kvartire][0]')).toBe('10660');
    expect(() => parser.buildSearchUrl({ ...q, rooms: 5 })).toThrow('UNSUPPORTED_FILTER');
  });
  it.each(['flat','rent-flat','sale-room','rent-room','sale-house','rent-house','office','warehouse'])("parses %s replay without seller fields or foreign city", name => {
    const page = parseYoulaFeed(fixture(name), url, cityId);
    expect(page.results.every(p => p.city === 'Новосибирск')).toBe(true);
    for (const p of page.results) { expect(p.phone).toBeNull(); expect(p.description).toBeNull(); expect(p).not.toHaveProperty('owner'); expect(p.images.every(u=>u.startsWith('https://'))).toBe(true); }
    if (name === 'warehouse') expect(page).toMatchObject({ results: [], hasNext: false });
    else expect(page.results.length).toBeGreaterThan(0);
  });
  it("scales attributes/kopecks, reads timestamp dates and district, keeps unit unknown", () => {
    const raw = parseYoulaProduct(fixture('detail-rent-flat'), 'Новосибирск');
    expect(raw).toMatchObject({ category:'residential', residentialType:'flat', deal:'rent', price:34000, area:43, floor:3, rooms:2, district:'Центральный район' });
    const normalized = normalizeListing(raw);
    expect(normalized).toMatchObject({ price:'34000.00', area:43, priceUnit:null, publishedAt:new Date(fixture('detail-rent-flat').datePublished.timestamp*1000).toISOString() });
    expect(normalizeListing({ ...raw, priceText:'34 000 ₽/мес.' }).priceUnit).toBe('rub_month');
    expect(normalizeListing(parseYoulaProduct(fixture('detail-flat'))).priceUnit).toBe('rub_total');
  });
  it("uses actual category and attributes, never requested purpose", () => {
    const raw=fixture('detail-flat');
    expect(parseYoulaProduct({...raw,subcategory:2013,attributes:[{slug:'kommer_realty_tip_stroeniya',values:[{id:165974}]},{slug:'tip_sdelki',values:[{id:10806}]}]})).toMatchObject({category:'commercial',propertyType:'warehouse',deal:'rent',residentialType:null});
    expect(parseYoulaProduct({...raw,subcategory:999,attributes:[]})).toMatchObject({category:null,deal:null});
    expect(parseYoulaProduct({...raw,attributes:[{slug:'komnat_v_kvartire',values:[{id:10660}]}]})).toMatchObject({rooms:0,residentialType:'studio'});
  });
  it("reads inert state only and never executes JavaScript", () => {
    expect(youlaState(`<script>window.__YOULA_STATE__ = {"entities":{"products":{}}};evil();</script>`)).toEqual({entities:{products:{}}});
    expect(youlaState('window.__YOULA_STATE__ = evil()')).toEqual({});
    expect(youlaState('window.__YOULA_STATE__ = {broken}')).toEqual({});
  });
  it.each([{}, {errors:[{message:'blocked'}]}, {data:{feed:{items:[],pageInfo:{}}}}])("rejects malformed feed instead of empty success %j", payload => {
    expect(()=>parseYoulaFeed(payload,url,cityId)).toThrow('API_RESPONSE_FAILED');
  });
  it("validates cursor progress and resumes feed with cursor", async () => {
    const { parser, transport } = client();
    const page = await parser.searchPage(q);
    expect(page.hasNext).toBe(true);
    transport.mockResolvedValueOnce({data:fixture('warehouse')});
    await Reflect.apply(parser.searchPage,parser,[{...q,page:2},page.nextUrl]);
    const request=transport.mock.calls[1]![0];
    expect((request.data as {variables:{cursor:string}}).variables.cursor).toBe('replay-cursor-1');
    expect(()=>parseYoulaFeed(fixture('flat'),page.nextUrl!,cityId)).toThrow('PAGINATION_FAILED');
    await expect(parser.searchPage({...q,page:2})).rejects.toThrow('CURSOR_REQUIRED');
  });
  it("sends actual category and keeps commercial warehouse id", async () => {
    const {parser,transport}=client();
    await parser.searchPage({...q,type:'room',deal:'rent'});
    expect(transport.mock.calls[0]![0].headers).toMatchObject({uid:expect.any(String),'x-uid':expect.any(String),'x-app-id':'web/3'});
    expect((transport.mock.calls[0]![0].data as {variables:unknown}).variables).toMatchObject({attributes:expect.arrayContaining([{slug:'categories',value:['arenda-komnati'],from:null,to:null}])});
    await parser.searchPage({...q,category:'commercial',type:'warehouse',deal:'rent'});
    expect((transport.mock.calls[1]![0].data as {variables:unknown}).variables).toMatchObject({attributes:expect.arrayContaining([{slug:'kommer_realty_tip_stroeniya',value:['165974'],from:null,to:null}])});
  });
  it("bounds details across branches and retains SERP if detail fails", async () => {
    const {parser,transport}=client(1);
    transport.mockResolvedValueOnce({data:fixture('flat')}).mockRejectedValueOnce(new Error('unavailable'));
    expect((await parser.searchPage(q)).results.length).toBeGreaterThan(0);
    await parser.searchPage({...q,type:'room'});
    expect(transport).toHaveBeenCalledTimes(3); // 2 feeds, only 1 detail attempt.
  });
  it("enriches only matching identity with whitelist and keeps date/floor", async () => {
    const {parser,transport}=client(1); const feed=fixture('flat'); const product=feed.data.feed.items.find((i:{product?:{location:{city:string}}})=>i.product?.location.city===cityId).product;
    const detail={...fixture('detail-flat'),id:product.id,url:product.url,owner:{phone:'must-not-escape'}};
    transport.mockResolvedValueOnce({data:feed}).mockResolvedValueOnce({data:`<script>window.__YOULA_STATE__ = ${JSON.stringify({entities:{products:{[detail.id]:detail}}})};</script>`});
    const page=await parser.searchPage(q);
    expect(page.results[0]).toMatchObject({area:61.4,floor:9,phone:null});
    expect(page.results[0]).not.toHaveProperty('owner');
  });
  it.each(['NEEDS_USER_ACTION','RATE_LIMITED','ABORTED'])("does not hide detail access failure %s",async code=>{
    const {parser,transport}=client(1);transport.mockResolvedValueOnce({data:fixture('flat')}).mockRejectedValueOnce(Object.assign(new Error(code),{code}));
    await expect(parser.searchPage(q)).rejects.toMatchObject({code});
  });
  it("keeps full adapter residential fanout supported for flat/room/house", async () => {
    const transport=vi.fn<RealEstateScraper.Transport>(async request=>request.method==='POST'?{data:fixture('flat')}:{data:'<script>window.__YOULA_STATE__ = {"entities":{"cities":[{"id":"'+cityId+'","slug":"novosibirsk","name":"Новосибирск"}]}};</script>'});
    const adapter=new RealEstateScraperAdapter({enabled:true,browserEnabled:false,depth:{maxPages:1,limit:12},factory:async config=>extendSourceParsers(new RealEstateScraper({...config,transport,delay:0,maxRetries:0}),{maxCards:0})});
    const result=await adapter.searchDetailed({city:'Новосибирск',operation:'sale',purposes:['residential'],sources:['youla']});
    expect(result.sources[0]).toMatchObject({status:'partial',failureCode:'UNSUPPORTED_FILTER'}); // cottage/townhouse explicitly unavailable.
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.listings.every(p=>p.listing.structuredFeatures.category==='residential')).toBe(true);
  });
  it("rejects foreign source URLs and omits missing/foreign cities", () => {
    for (const value of ['https://example.org/a','http://youla.ru/a','https://youla.ru.evil.test/a','https://u:p@youla.ru/a']) {
      expect(()=>parseYoulaProduct({...fixture('detail-flat'),url:value})).toThrow('INVALID_URL');
    }
    const payload={data:{feed:{items:[{product:{...fixture('detail-flat'),location:{city:'other'}}},{product:{...fixture('detail-flat'),location:{}}}],pageInfo:{hasNextPage:false}}}};
    expect(parseYoulaFeed(payload,url,cityId).results).toEqual([]);
  });
  it("never borrows attributes/dates from a different detail product", async()=>{
    const {parser,transport}=client(1);
    transport.mockResolvedValueOnce({data:fixture('flat')}).mockResolvedValueOnce({data:'<script>window.__YOULA_STATE__ = {"entities":{"products":{"other":{"id":"other","datePublished":{"timestamp":1793691673}}}}};</script>'});
    const page=await parser.searchPage(q);
    expect(page.results[0]).toMatchObject({floor:null,publishedAt:null});
  });

  it("paces requests and cancels the wait before issuing transport", async()=>{
    vi.useFakeTimers();
    try {
      const transport=vi.fn<RealEstateScraper.Transport>(async()=>({data:fixture('warehouse')}));
      const scraper=new RealEstateScraper({transport,maxRetries:0});
      attachYoulaParser(scraper,{maxCards:0,minRequestIntervalMs:1100});
      await scraper.parsers.youla.searchPage(q);
      const next=scraper.parsers.youla.searchPage(q);
      await vi.advanceTimersByTimeAsync(1099); expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); await next; expect(transport).toHaveBeenCalledTimes(2);
      const controller=new AbortController();
      const cancelled=scraper.parsers.youla.searchPage({...q,signal:controller.signal});
      const rejection=expect(cancelled).rejects.toMatchObject({code:'ABORTED'});
      controller.abort(); await rejection; expect(transport).toHaveBeenCalledTimes(2);
    } finally {vi.useRealTimers();}
  });

});
