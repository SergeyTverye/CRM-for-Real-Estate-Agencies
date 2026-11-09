import { describe, expect, it } from "vitest";
import RealEstateScraper from "real-estate-scrapper";
import { readFileSync } from "node:fs";
import { parseRooms } from "@/modules/property-search/domain/housing";
import { chooseLocations } from "@/modules/property-search/domain/geography";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { listingQuality, cardQuality, enrichListingQuality } from "@/modules/property-search/infrastructure/listing-quality";
import { normalizeListing } from "@/modules/property-search/infrastructure/normalization";
import { buildScraperQueries } from "@/modules/property-search/infrastructure/source-filters";
import { extendSourceParsers } from "@/modules/property-search/infrastructure/parser-extension";
import { boundSourceQueries, resolveSourceDepth } from "@/modules/property-search/infrastructure/source-limits";
import { resetAdvancedSearchFilters } from "@/app/(crm)/property-search/filter-presentation";
const signal = new AbortController().signal;
const fixture = JSON.parse(readFileSync("tests/fixtures/scraper/onrealt.json", "utf8")).results[0];
const listing = (patch: Partial<NormalizedListing> = {}) => ({ ...normalizeListing(fixture), title: "2-к. квартира", city: "Бердск", purpose: null, operation: "sale", ...patch }) as NormalizedListing;
describe("v323 explicit quality facts, offline REPLAY", () => {
  it.each([["2-к. квартира",2],["Двухкомнатная квартира",2],["Студия",0],["трёхкомнатная",3],["4-комн. квартира",4],["квартира 50 м², 2/9 этаж",null]] as const)("reads %s", (title, count) => expect(parseRooms(null,title)).toBe(count));
  it("uses structured rooms first, preserves studio zero and marks unknown", () => {
    expect(parseRooms(0,"Квартира")).toBe(0);
    const filters = SearchFilters.parse({operation:"sale",propertyKinds:["flat"],rooms:["2","4+"],locations:["berdsk"]});
    expect(evaluateListing(listing(),filters).criteria.find(c=>c.criterion==="rooms")?.state).toBe("matched");
    expect(evaluateListing(listing({rooms:1}),filters).verdict).toBe("rejected");
    expect(evaluateListing(listing({rooms:5}),filters).criteria.find(c=>c.criterion==="rooms")?.state).toBe("matched");
    expect(evaluateListing(listing({title:"Квартира",rooms:null}),filters).criteria.find(c=>c.criterion==="rooms")?.state).toBe("unknown");
  });
  it.each(["/мес","в месяц","за м² в год","посуточно","за сутки","в год"])("extracts explicit period: %s", period => {
    const facts = listingQuality({priceText:`50000 ₽ ${period}`});
    expect(facts.rentalPeriod).toBe(period === "посуточно" || period === "за сутки" ? "day" : "long_term");
    expect(facts.priceUnit).toBe(period === "/мес" || period === "в месяц" ? "rub_month" : period === "в год" ? "rub_year" : period === "за м² в год" ? "rub_m2_year" : null);
  });
  it("does not guess monthly or interpret total area as a rate per metre", () => {
    expect(listingQuality({deal:"rent",priceText:"50000 ₽"}).priceUnit).toBeUndefined();
    expect(listingQuality({title:"Офис 120 м²",description:"50000 ₽ в месяц"}).priceUnit).toBe("rub_month");
    expect(listingQuality({bargainTerms:{paymentPeriod:"annually",priceType:"squareMeter"}}).priceUnit).toBe("rub_m2_year");
  });
  it("keeps daily prices incomparable and excludes them from monthly searches", () => {
    const daily = enrichListingQuality(listing({operation:"rent",priceUnit:null,description:"Сдаётся посуточно. 2500 ₽ за сутки"}));
    expect(daily.priceUnit).toBeNull();
    const evaluated = evaluateListing(daily,SearchFilters.parse({operation:"rent",priceUnit:"rub_month"}));
    expect(evaluated.verdict).toBe("rejected");
    expect(evaluated.criteria.find(c=>c.criterion==="rentalPeriod")?.evidence).toContain("Посуточная");
  });
  it("confirms apartments only from source evidence; broad flat category remains unknown", () => {
    const filters=SearchFilters.parse({operation:"sale",propertyKinds:["apartments"]});
    expect(evaluateListing(listing({description:"Продаются апартаменты"}),filters).criteria.find(c=>c.criterion==="propertyKind")?.state).toBe("matched");
    expect(evaluateListing(listing(),filters).criteria.find(c=>c.criterion==="propertyKind")?.state).toBe("unknown");
    expect(listingQuality({isApartments:true}).apartments).toBe(true);
    expect(listingQuality({category:"apartments",title:"Объект"}).apartments).toBe(true);
    expect(listingQuality({isApartment:true}).apartments).toBeUndefined();
  });
  it("scopes periods to the matching card, never another card or the page header", () => {
    const html='<h1>Аренда в месяц</h1><article><a href="/1">Офис</a><b class="price">100 ₽ за м² в год</b></article><article><a href="/2">Офис</a><b class="price">500 ₽</b></article>';
    expect(cardQuality(html,{url:"https://onrealt.ru/1"},"article")).toMatchObject({priceUnit:"rub_m2_year"});
    expect(cardQuality(html,{url:"https://onrealt.ru/2"},"article")).not.toHaveProperty("priceUnit");
  });
  it.each(["mirkvartir","onrealt","youla","yandex","cian"] as const)("passes rooms to %s public URL", async source => {
    const client=extendSourceParsers(new RealEstateScraper(),{maxCards:0});
    const filters=SearchFilters.parse({operation:"sale",city:"Новосибирск",propertyKinds:["flat"],rooms:["2"]});
    const query=buildScraperQueries(filters,source,signal)[0]!;
    const url=decodeURIComponent(client.parsers[source].buildSearchUrl(query));
    expect(url).toMatch(source==="mirkvartir" ? /Двухкомнатные/ : source==="onrealt" ? /2-komnatnuju/ : source==="youla" ? /10655/ : source==="yandex" ? /roomsTotal=2/ : /room2=1/);
    await client.close();
  });
  it("splits native single-count ORs, uses broad fallback for 4+ and exposes commercial fanout", () => {
    const filters=SearchFilters.parse({operation:"sale",propertyKinds:["flat"],rooms:["studio","2"]});
    expect(buildScraperQueries(filters,"onrealt",signal)).toHaveLength(2);
    const district=buildScraperQueries({...filters,locations:["akademgorodok"],rooms:["2"]},"mirkvartir",signal)[0]!;
    expect(decodeURIComponent(district.sourceOptions!.mirkvartir!.url!)).toContain("Советский/Двухкомнатные/");
    expect(buildScraperQueries({...filters,rooms:["4+"]},"onrealt",signal)[0]?.rooms).toBeUndefined();
    const commercial=buildScraperQueries(SearchFilters.parse({operation:"sale",purposes:["office","warehouse"]}),"onrealt",signal);
    expect(boundSourceQueries("onrealt",commercial,resolveSourceDepth("onrealt")).queries).toHaveLength(2);
  });
  it("replaces only implicit Novosibirsk, preserves explicit city and reset/replayed filters", () => {
    expect(chooseLocations(["novosibirsk"],"berdsk",true)).toEqual(["berdsk"]);
    expect(chooseLocations(["novosibirsk"],"berdsk",false)).toEqual(["novosibirsk","berdsk"]);
    expect(chooseLocations(["berdsk"],"novosibirsk",false)).toEqual(["berdsk","novosibirsk"]);
    const saved=SearchFilters.parse({operation:"sale",locations:["berdsk"],rooms:["2"],propertyKinds:["flat"]});
    expect(SearchFilters.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(resetAdvancedSearchFilters(saved)).toMatchObject({locations:["berdsk"],rooms:["2"],propertyKinds:["flat"]});
  });
});
