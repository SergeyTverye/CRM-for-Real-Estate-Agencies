import { expect, it } from "vitest";
import { decodeParseResult, providerParseSchema, providerParseInstructions } from "@/modules/ai/domain/provider-parse";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { preserveSearchConditions } from "@/modules/ai/domain/listing-analysis";
const base={city:"Новосибирск",operation:"sale",priceUnit:"rub_total",priceFrom:null,priceTo:null,areaFrom:null,areaTo:null,floorMode:"any",seller:"all",purposes:[],districts:[],requiredFeatures:[],preferredFeatures:[],sources:["cian"],clarificationQuestion:null};
it("provider publishes new fields and geography instructions",()=>{
 expect(providerParseSchema.required).toEqual(expect.arrayContaining(["locations","propertyKinds"]));
 expect(providerParseInstructions).toContain("novosibirsk-region");
});
it.each([
 ["Двушка в Бердске до 5 млн",{city:"Бердск",locations:["berdsk"],propertyKinds:["flat"],priceTo:"5000000",requiredFeatures:["2 комнаты"]}],
 ["Склад от 300 метров у Оби в аренду",{city:"Обь",locations:["ob"],propertyKinds:[],operation:"rent",priceUnit:"rub_month",areaFrom:300,purposes:["warehouse"]}],
 ["Апартаменты в Новосибирске на продажу",{locations:["novosibirsk"],propertyKinds:["apartments"]}],
 ["Любое нежилое до 50 тысяч в месяц в Новосибирске и пригородах",{locations:["suburbs"],propertyKinds:["non_residential"],operation:"rent",priceUnit:"rub_month",priceTo:"50000"}],
 ["Офис 50–100 м² в Академгородке",{locations:["akademgorodok"],propertyKinds:[],purposes:["office"],areaFrom:50,areaTo:100}],
 ["Дом на продажу в Новосибирской области",{locations:["novosibirsk-region"],propertyKinds:["house"]}],
 ["Склад в Оби и Новосибирске",{locations:["ob","novosibirsk"],propertyKinds:[],purposes:["warehouse"]}],
] as const)("REPLAY: %s",(text,fields)=>{
 const proposed=decodeParseResult(JSON.stringify({...base,...fields})).filters!;
 const before=SearchFilters.parse({operation:"sale",locations:["novosibirsk"],propertyKinds:["flat"],districts:["Центральный"]});
 const after=SearchFilters.parse(preserveSearchConditions(before,proposed,text));
 expect(after.locations).toEqual(fields.locations);
 expect(after.propertyKinds).toEqual(fields.propertyKinds.length?fields.propertyKinds:undefined);
 expect(after.districts).toEqual([]);
 if("areaFrom" in fields)expect(after.areaFrom).toBe(fields.areaFrom);
 if("priceTo" in fields)expect(after.priceTo).toBe(fields.priceTo);
});
it("rejects invented stable location/type IDs",()=>{
 for(const bad of [{locations:["moon"]},{propertyKinds:["villa"]}])expect(()=>decodeParseResult(JSON.stringify({...base,...bad}))).toThrow();
});
it("budget-only refinement preserves geography and type",()=>{
 const before=SearchFilters.parse({operation:"sale",locations:["berdsk"],propertyKinds:["apartments"]});
 const after=preserveSearchConditions(before,SearchFilters.parse({operation:"sale",priceTo:"5000000"}),"Бюджет до 5 млн");
 expect(after).toMatchObject({locations:["berdsk"],propertyKinds:["apartments"],priceTo:"5000000"});
});
