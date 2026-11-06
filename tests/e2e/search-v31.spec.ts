import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import pg from "pg";
import { login } from "./helpers";

const filters={city:"Новосибирск",operation:"sale",priceUnit:"rub_total",purposes:["office"],floorMode:"any",districts:[],seller:"all",requiredFeatures:[],preferredFeatures:[],sources:["cian"]};
async function authenticate(page:Page){
  if(process.env.SEARCH_UI_DEMO_MODE==="true"){
    const env=parse(readFileSync(".env"));
    await page.goto("/login");
    const response=await page.request.post("/api/v1/auth/login",{headers:{origin:new URL(page.url()).origin},data:{login:env.SEED_REALTOR1_LOGIN??"realtor1",password:env.SEED_REALTOR1_PASSWORD}});
    expect(response.ok()).toBeTruthy();
  }else await login(page,"realtor1");
}
const csv=(value:unknown)=>`"${String(value).replaceAll('"','""')}"`;
async function importRows(request:APIRequestContext,source:string,rows:unknown[][]){
  const text=["url;Title;operation;propertyType;Price;Area;City;Address;Description",...rows.map(row=>row.map(csv).join(";"))].join("\r\n");
  const origin=new URL((await request.get("/api/health/live")).url()).origin;
  const response=await request.post("/api/v1/property-search/imports",{headers:{origin},multipart:{file:{name:"synthetic-search-ui.csv",mimeType:"text/csv",buffer:Buffer.from(text)},format:"csv",source,filters:JSON.stringify(filters),commit:"true"}});
  expect(response.ok(),`import HTTP ${response.status()}`).toBeTruthy();
  const data=await response.json();expect(data.importedCount).toBe(rows.length);return data.runId as string;
}
async function visibleIds(page:Page){return page.locator("[data-listing-id]").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-listing-id")));}
async function chooseNonemptyTab(page:Page,runId:string){
  const response=await page.request.get(`/api/v1/property-search/runs/${runId}/results`);expect(response.ok()).toBeTruthy();const data=await response.json();
  const label=data.counts.confirmed?"Совпадения":data.counts.needs_review?"Требуют проверки":"Исключены";
  await page.getByRole("tab",{name:new RegExp(`^${label} \\(`)}).click();await expect(page.locator("[data-listing-id]").first()).toBeVisible();
}

test.describe("Поиск v3.1: реальные API и браузер без платного AI",()=>{
  test("AT-01/02/03/07/09: форма, REPLAY, страницы, дубли, массовые операции и безопасный XLSX",async({page},testInfo)=>{
    test.setTimeout(300_000);await authenticate(page);
    const token=Date.now(),pairAddress=`Новосибирск, улица UI-${token}, 1`;
    const rows=Array.from({length:31},(_,i)=>[`https://cian.ru/sale/commercial/${token+i}/`,"Синтетический офис","sale","office",100000+i*1000,100,"Новосибирск",i===0?pairAddress:i===30?'=HYPERLINK("https://example.invalid")':`Новосибирск, улица UI-${token}, ${i+1}`,"Офис в нежилом здании"]);
    const runId=await importRows(page.request,"cian",rows);
    await importRows(page.request,"avito",[[`https://avito.ru/novosibirsk/kommercheskaya_nedvizhimost/office_${token}`,"Синтетический офис","sale","office",100000,100,"Новосибирск",pairAddress,"Офис в нежилом здании"]]);
    await page.goto(`/property-search?runId=${runId}`);
    await expect(page.getByText(/REPLAY · сохранённые данные от/)).toBeVisible();
    await expect(page.getByText(/ИЛИ между назначениями, И между остальными обязательными/)).toBeVisible();
    await chooseNonemptyTab(page,runId);
    await page.getByLabel("Вид",{exact:true}).selectOption("table");
    await page.getByLabel("На странице",{exact:true}).selectOption("10");
    await expect(page.locator("[data-listing-id]")).toHaveCount(10);
    const first=await visibleIds(page);await page.getByRole("button",{name:"Далее",exact:true}).click();
    await expect(page.getByText(/Страница 2 из/)).toBeVisible();await expect(page.locator("[data-listing-id]")).toHaveCount(10);
    const second=await visibleIds(page);expect(second.some(id=>first.includes(id))).toBeFalsy();
    for(const value of ["publication","first_seen","source_updated","price","price_per_m2","area","match","last_checked","price_change"]){
      const response=page.waitForResponse(r=>r.url().includes("/results?")&&r.url().includes(`sort=${value}`));await page.getByLabel("Сортировка",{exact:true}).selectOption(value);expect((await response).ok()).toBeTruthy();
    }
    await page.getByLabel("Направление",{exact:true}).selectOption("asc");
    await page.getByLabel("Сортировка",{exact:true}).selectOption("price");
    const group=page.getByRole("article",{name:"Группа вероятных дублей"}).first();
    await expect(group).toBeVisible();await group.getByRole("button",{name:"Решить позже",exact:true}).click();
    await page.getByLabel("Подтверждаю выбранное решение").check();
    await page.getByRole("dialog").getByRole("button",{name:"Решить позже",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByText("Видимые колонки (запоминаются)",{exact:true}).click();
    await page.getByLabel("Этаж",{exact:true}).last().check();await page.reload();await chooseNonemptyTab(page,runId);
    await expect(page.getByRole("columnheader",{name:"Этаж",exact:true})).toHaveCount(0); // view defaults to cards, column preference survives independently
    await page.getByLabel("Вид",{exact:true}).selectOption("table");await expect(page.getByRole("columnheader",{name:"Этаж",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Выделить страницу",exact:true}).click();
    await page.getByRole("button",{name:"Закладка",exact:true}).click();await page.getByRole("button",{name:"Подтвердить действие",exact:true}).click();
    await expect(page.getByText(/Обработано: \d+ из \d+/)).toBeVisible();
    await page.getByRole("button",{name:"В именованную подборку",exact:true}).first().click();
    await page.getByLabel("Название новой подборки").fill(`UI v3.1 ${token}`);await page.getByRole("button",{name:"Подтвердить действие",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const exported=page.waitForEvent("download");await page.getByRole("button",{name:"Экспорт XLSX / CSV",exact:true}).click();await page.getByRole("button",{name:"Скачать файл",exact:true}).click();
    const download=await exported;expect(download.suggestedFilename()).toBe("property-search.xlsx");const filePath=testInfo.outputPath("search-all.xlsx");await download.saveAs(filePath);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(filePath);expect(workbook.worksheets[0]!.rowCount).toBe(32);
    let escaped=false;workbook.worksheets[0]!.eachRow(row=>row.eachCell(cell=>{expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);if(cell.text.startsWith("'=HYPERLINK"))escaped=true;}));expect(escaped).toBeTruthy();
    // Selected export must contain the page, not all 31 records.
    await page.getByRole("button",{name:"Экспорт XLSX / CSV",exact:true}).click();await page.getByLabel("Область",{exact:true}).selectOption("selected");
    const selectedDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Скачать файл",exact:true}).click();const selectedPath=testInfo.outputPath("search-selected.xlsx");await(await selectedDownload).saveAs(selectedPath);const selectedBook=new ExcelJS.Workbook();await selectedBook.xlsx.readFile(selectedPath);expect(selectedBook.worksheets[0]!.rowCount).toBe(26);
    await page.getByRole("button",{name:"Экспорт XLSX / CSV",exact:true}).click();
    await page.getByLabel("Область",{exact:true}).selectOption("all");
    await page.getByRole("dialog").getByRole("combobox").first().selectOption("csv");
    const csvDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Скачать файл",exact:true}).click();
    const csvPath=testInfo.outputPath("search-all.csv");await(await csvDownload).saveAs(csvPath);
    const csvBytes=readFileSync(csvPath);expect(csvBytes.subarray(0,3).toString("hex")).toBe("efbbbf");expect(csvBytes.toString("utf8")).toContain("'=HYPERLINK");
    await page.getByLabel("Режим даты",{exact:true}).selectOption("published");
    await page.getByLabel("Период",{exact:true}).selectOption("7");await expect(page.getByText(/Дата неизвестна \(31\)/)).toBeVisible();
    await page.getByLabel(/Дата неизвестна \(31\)/).check();await expect(page.locator("[data-listing-id]")).toHaveCount(25);
    await page.getByLabel("Режим даты",{exact:true}).selectOption("first_seen");await expect(page.getByLabel(/Дата неизвестна/)).toHaveCount(0);
    await page.getByLabel("Период",{exact:true}).selectOption("custom");await page.getByLabel("Дата от",{exact:true}).fill("2020-01-01");await page.getByLabel("Дата до",{exact:true}).fill("2030-12-31");
    await page.getByRole("button",{name:"Без ограничения даты",exact:true}).click();
    await page.getByRole("tab",{name:/^Совпадения/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("search-desktop.png")});
    await page.setViewportSize({width:360,height:900});await page.getByLabel("Вид",{exact:true}).selectOption("cards");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.getByRole("tab",{name:/^Совпадения/}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("search-mobile.png")});
  });

  test("AT-06: идемпотентный запуск и остановка очереди",async({page},testInfo)=>{
    test.setTimeout(120_000);
    await authenticate(page);
    const databaseUrl=process.env.E2E_DATABASE_URL??"postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";
    if(new URL(databaseUrl).pathname!=="/crm_e2e")throw new Error("Queue cancellation fixture requires crm_e2e");
    const queueLock=new pg.Client({connectionString:databaseUrl});
    const diagnostics:unknown[]=[];
    const record=(event:string,data:unknown)=>{diagnostics.push({event,at:new Date().toISOString(),data});};
    const summarize=(p:{status?:string;cancelRequested?:boolean;sources?:{source:string;status:string}[]})=>({status:p.status,cancelRequested:p.cancelRequested,sources:p.sources?.map(s=>({source:s.source,status:s.status}))});
    await queueLock.connect();
    try{
      // Reserve the real worker's durable claim slot until cancellation. An instant
      // fixture must not complete between observing an active UI and POST /cancel.
      // This lock changes no records and is released on every exit/connection close.
      await queueLock.query("SELECT pg_advisory_lock(310105)");
      const body={filters,sources:["cian"],idempotencyKey:`ui-cancel-${Date.now()}`,deadlineMs:600000};
      const origin=new URL(page.url()).origin;
      const first=await page.request.post("/api/v1/property-search/runs",{headers:{origin},data:body});
      expect(first.ok()).toBeTruthy();const run=await first.json();
      const second=await page.request.post("/api/v1/property-search/runs",{headers:{origin},data:body});
      expect(second.ok()).toBeTruthy();expect((await second.json()).id).toBe(run.id);
      const cancelPath=`/api/v1/property-search/runs/${run.id}/cancel`;
      page.on("request",request=>{if(new URL(request.url()).pathname===cancelPath)record("cancel_request",{method:request.method()});});
      const readProgress=async()=>{
        const response=await page.request.get(`/api/v1/property-search/runs/${run.id}/progress`);
        const data=await response.json();record("progress",{httpStatus:response.status(),...summarize(data)});
        expect(response.ok()).toBeTruthy();return data;
      };
      await page.goto(`/property-search?runId=${run.id}`);
      expect(await readProgress()).toMatchObject({status:"queued",cancelRequested:false});
      const [response]=await Promise.all([
        page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname===cancelPath),
        page.getByRole("button",{name:"Остановить",exact:true}).click(),
      ]);
      const data=await response.json();
      record("cancel_response",{httpStatus:response.status(),...summarize(data),errorCode:data.error?.code});
      expect(response.ok()).toBeTruthy();
      expect(data).toMatchObject({status:"partial",cancelRequested:true});
      await expect.poll(async()=>summarize(await readProgress())).toEqual({status:"partial",cancelRequested:true,sources:[{source:"cian",status:"cancelled"}]});
      await queueLock.query("SELECT pg_advisory_unlock(310105)");
      expect(await readProgress()).toMatchObject({status:"partial",cancelRequested:true});
      await expect(page.getByText("Отмена запрошена. Полученные данные сохраняются.",{exact:true})).toBeVisible();
    }finally{
      await queueLock.end();
      console.log("AT-06 diagnostics",JSON.stringify(diagnostics));
      await testInfo.attach("cancel-diagnostics",{body:JSON.stringify(diagnostics,null,2),contentType:"application/json"});
    }
  });
  test("AT-01: расширенные фильтры из формы и защита повторного нажатия",async({page})=>{
    await authenticate(page);await page.goto("/property-search");
    await page.getByLabel("Город",{exact:true}).fill("Москва");
    await page.getByLabel("Офис",{exact:true}).check();await page.getByLabel("Торговля",{exact:true}).check();
    await page.getByLabel("Мощность кВт от",{exact:true}).fill("15");await page.getByLabel("Мощность кВт до",{exact:true}).fill("50");
    await page.getByLabel("Отдельный вход",{exact:true}).selectOption("true");
    await page.getByLabel("Период",{exact:true}).selectOption("24h");
    const launched=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/v1/property-search/runs");
    await page.getByRole("button",{name:"Искать",exact:true}).click();const response=await launched;expect(response.ok()).toBeTruthy();
    const sent=response.request().postDataJSON();expect(sent.filters.features.power_kw).toEqual({min:15,max:50});expect(sent.filters.features.separate_entrance).toBe(true);expect(sent.filters.purposes).toEqual(expect.arrayContaining(["office","retail"]));expect(sent.filters.freshness.period).toBe("24h");expect(sent.idempotencyKey).toBeTruthy();
    const run=await response.json();expect((await(await page.request.post("/api/v1/property-search/runs",{headers:{origin:new URL(page.url()).origin},data:sent})).json()).id).toBe(run.id);
    await page.request.post(`/api/v1/property-search/runs/${run.id}/cancel`,{headers:{origin:new URL(page.url()).origin}});
  });
  test("REPLAY сохранённых LIVE результатов без запросов площадок",async({page},testInfo)=>{
    test.skip(!process.env.SEARCH_UI_REPLAY_RUN,"Передайте ID собственного сохранённого LIVE-запуска на demo-БД");
    await authenticate(page);await page.goto(`/property-search?runId=${process.env.SEARCH_UI_REPLAY_RUN}`);
    await expect(page.getByText(/REPLAY · сохранённые данные от/)).toBeVisible();await chooseNonemptyTab(page,process.env.SEARCH_UI_REPLAY_RUN!);
    await expect(page.getByText("Загрузка прогресса…",{exact:true})).toHaveCount(0);
    await page.getByRole("tab",{name:/^Требуют проверки/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("search-live-replay.png")});
  });
});
