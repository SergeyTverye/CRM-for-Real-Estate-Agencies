import { describe, it, expect } from "vitest";
import { sanitizeCallNote, sanitizeFreeNote, sanitizeFactContacts, decodeCallNote, checkOfferNumbers, numericTokens, providerCallNoteSchema } from "@/modules/ai/domain/p2-drafts";
import { SearchAi } from "@/modules/ai/infrastructure/search-ai";
import { FakeResponsesProvider,InMemoryAiLedger } from "@/modules/ai/infrastructure/fake";
import { AiGate } from "@/modules/ai/domain/gate";
describe("P2 draft boundaries",()=>{
  it.each(["звонил Иван петров", "иван петров", "ИвАн ПеТрОв", "говорил с назаром дубровским", "контакт назар дубровский", "ЛПР назар дубровский", "И. Петров", "и. петров", "И. С. Петров"])("redacts mixed case and introduced identities: %s", note => {
    for (const sanitize of [sanitizeCallNote, sanitizeFreeNote]) expect(sanitize(note)).not.toMatch(/иван|петров|назар|дубровск/iu);
  });
  it.each(["с златой белозеровой", "злате белозеровой", "ЗЛАТА БЕЛОЗЕРОВА"])("redacts known CRM identities in declined forms: %s", note => {
    expect(sanitizeCallNote(note, ["Злата Белозерова"])).not.toMatch(/злат|белозер/iu);
  });
  it.each(["юрия толстого", "павлу белому", "льву черному", "любови зеленой", "илье синему", "яне белой"])("removes declined names and known adjective surnames: %s", note => {
    expect(sanitizeCallNote(note, ["Юрий Толстой", "Павел Белый", "Лев Черный", "Любовь Зеленая", "Илья Синий", "Яна Белая"]).replace(/\[PERSON\]|\s/gu, "")).toBe("");
  });
  it.each(["+7 (900) 123-45-67 доб. 123", "+44 20 7946 0958 ext: 42", "8-800-555-35-35 добавочный 42", "9001234567", "1234567", "123-45-67", "123 45 67", "8 (383) 123 45 67 ext. 99", "имя.фамилия@example.ru"])("redacts contact format: %s", contact => {
    expect(sanitizeCallNote(contact)).not.toMatch(/\d|example/);
  });
  it.each(["контакт test@example.com", "и.петров@example.ru", "Иван.Петров@example.ru"])("redacts emails before names can split them: %s", note => {
    expect(sanitizeCallNote(note)).not.toMatch(/@|example|test|петров/iu);
  });
  it("keeps public multiword addresses and snapshot terms", () => {
    expect(sanitizeCallNote("Красный Проспект, 25")).toBe("Красный Проспект, 25");
    expect(sanitizeFactContacts("Красный Проспект, 25; улица Ивана Петрова; 80 м²; 100000 ₽; +7 900 123-45-67"))
      .toBe("Красный Проспект, 25; улица Ивана Петрова; 80 м²; 100000 ₽; [PHONE]");
  });
  it.each(["ул.", "улица", "пр.", "пр-т", "проспект", "пер.", "переулок", "ш.", "шоссе", "пл.", "площадь", "б-р", "бульвар", "наб.", "набережная", "мкр", "район", "р-н"])("preserves a toponym after %s while removing identities outside the address", marker => {
    const address = `${marker} Ленина 10`;
    const safe = sanitizeFreeNote(`${address}; Иван Петров просит офис; +7 (900) 123-45-67`, ["Иван Петров", "Ленина"]);
    expect(safe).toContain(address);
    expect(safe).not.toMatch(/Иван|Петров|900/iu);
  });
  it.each(["Красный Проспект, 25", "улица Ивана Петрова, 10", "ул. Октябрьская Магистраль, 3", "ул. ленина 10", "пр-т Карла Маркса 25/1"])("preserves address construction in a free note: %s", address => {
    expect(sanitizeFreeNote(`${address}; контакт назар дубровский`, ["Иван Петров"])).toBe(`${address}; [PERSON]`);
  });
  it("does not treat a personal name with a number as an address or exempt neighbouring private details", () => {
    const safe = sanitizeFreeNote("Иван Петров, 25; ул. Ленина 10; паспорт 1234 567890; test@example.com");
    expect(safe).toContain("ул. Ленина 10");
    expect(safe).not.toMatch(/Иван|Петров|1234|567890|example/iu);
  });
  it.each(["80–125 м²", "80 — 125", "80 - 125", "от 80 м² до 125", "от 80,5 м² до 125"])("rejects synthetic range: %s", text => {
    expect(() => checkOfferNumbers(text, { areas: [80, 80.5, 125] })).toThrow("AI_UNSUPPORTED_NUMBERS");
  });
  it("removes CRM names, separate name parts, phone, email and forbidden details",()=>{
    const safe = sanitizeCallNote("Петров Иван Сергеевич; Иван просит офис 80 м² за 100000 руб.; +7 (900) 123-45-67; test@example.com; паспорт 1234 567890",["Петров Иван Сергеевич"]);
    expect(safe).not.toMatch(/Петров|Иван|Сергеевич|900|test@example|1234|567890/);
    expect(safe).toContain("80 м²");expect(safe).toContain("100000 руб.");
  });
  it("removes names introduced in free text and multiword unknown identities",()=>{
    expect(sanitizeCallNote("Клиент: Александр Петров. Контакт: Ольга. John Smith просит офис.")).not.toMatch(/Александр|Петров|Ольга|John|Smith/);
  });
  it.each(["not json",JSON.stringify({filters:{operation:"rent"},clarificationQuestion:null,taskType:"call_or_contact",taskTitle:"Звонок",taskDescription:null,taskDueAt:null}),JSON.stringify({filters:{operation:"sale"},clarificationQuestion:null,taskType:"bad",taskTitle:"Звонок",taskDescription:null,taskDueAt:null})])("rejects malformed results",text=>expect(()=>decodeCallNote(text)).toThrow());
  it("accepts clarification with no guessed search and no guessed due date",()=>{
    expect(decodeCallNote(JSON.stringify({filters:null,clarificationQuestion:"Какую единицу цены использовать?",taskType:"call_or_contact",taskTitle:"Уточнить",taskDescription:null,taskDueAt:null}))).toMatchObject({filters:null,task:{dueAt:null}});
  });
  it("uses only flat provider schema",()=>expect(JSON.stringify(providerCallNoteSchema)).not.toMatch(/anyOf|oneOf|\$ref|format|minimum/));
  it("conservatively removes an unknown single personal name while keeping domain numbers",()=>{
    expect(sanitizeFreeNote("Позвонил Алексей, нужен офис 80 м² в Новосибирске")).not.toContain("Алексей");
    expect(sanitizeFreeNote("Нужен офис 80 м² в Новосибирске")).toContain("80 м² в Новосибирске");
    expect(sanitizeFreeNote("АЛЕКСЕЙ ПЕТРОВ: офис 80 м²")).not.toMatch(/АЛЕКСЕЙ|ПЕТРОВ/);
  });
  it("normalizes an unrequested owner-only restriction and empty sources without a second paid call",async()=>{
    const provider = new FakeResponsesProvider(()=>({text:JSON.stringify({filters:{operation:"sale",seller:"confirmed_owner_only",sources:[]},clarificationQuestion:null,taskType:"call_or_contact",taskTitle:"Уточнить",taskDescription:null,taskDueAt:null})}));
    const gate = new AiGate(new InMemoryAiLedger(),{enabled:true,webEnabled:false,autoFallback:false,requestsPerUserHour:30,requestsPerUserDay:30,callsPerJob:3,webCallsPerJob:1,webJobsPerUserDay:1,monthlyBudgetMicros:1000000000n},{getLimits:async()=>({})});
    const ai = new SearchAi(provider,gate,{findEffective:async model=>({id:"test",model,effectiveFrom:new Date("2020-01-01Z"),inputMicrosPerMillion:1000000n,outputMicrosPerMillion:1000000n,webSearchMicrosPerCall:1000000n,webInputTokenAllowance:0})},
      {model:"test",webModel:"",maxOutputTokens:1000,contextSize:"low",defaultRegion:"65",allowedDomains:[]});
    const result=await ai.parseCallNote({user:{userId:"u",active:true},ownerUserId:"u",jobId:"j",requestId:"r"},"Нужен офис");
    expect(result.filters?.seller).toBe("all");expect(result.filters?.sources).toHaveLength(7);expect(provider.requests).toHaveLength(1);
  });
  it("normalizes numeric formatting without inventing conversions",()=>{
    expect(numericTokens("80,50 м², 100 000 ₽")).toEqual(["80.5","100000"]);
    expect(()=>checkOfferNumbers("80,50 м² за 100 000 ₽",{area:"80.50",price:"100000.00"})).not.toThrow();
  });
  it.each(["81 м²", "50000 ₽", "2 млн ₽", "9000000 ₽"])("rejects unsupported numbers: %s",text=>expect(()=>checkOfferNumbers(text,{area:"80",price:"100000"})).toThrow("AI_UNSUPPORTED_NUMBERS"));
  it("rejects synthesized ranges even when both endpoints occur in source data",()=>expect(()=>checkOfferNumbers("Площади от 80 до 125,3 м²",{items:[{area:"80"},{area:"125.3"},{area:"148"},{area:"35.9"}]})).toThrow("AI_UNSUPPORTED_NUMBERS"));
});
