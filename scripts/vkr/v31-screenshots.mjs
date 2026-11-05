import { chromium, expect as baseExpect } from "@playwright/test";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
config({path:[".env.local",".env"],quiet:true});
const output="docs/screenshots/vkr/v31", baseURL="http://localhost:3416";
const expect=baseExpect.configure({timeout:60000});
const id=key=>{const h=createHash("sha256").update(`crm-demo-v241:${key}`).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({baseURL,viewport:{width:1440,height:900},locale:"ru-RU",timezoneId:"Asia/Novosibirsk"});
const page=await context.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
let records=[];try{records=JSON.parse(await readFile(`${output}/manifest.json`,"utf8"));}catch{}
async function login(role="MANAGER"){
 const r=await context.request.post("/api/v1/auth/login",{headers:{origin:baseURL},data:{login:process.env[`SEED_${role}_LOGIN`]??role.toLowerCase(),password:process.env[`SEED_${role}_PASSWORD`]}});expect(r.ok()).toBeTruthy();
}
async function go(url){await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.locator("h1").first()).toBeVisible();await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>Object.keys(b).some(k=>k.startsWith("__reactProps"))));}
async function shot(file,description){
 await page.evaluate(async()=>{await document.fonts.ready;});
 await expect(page.locator("body")).not.toContainText(/Application error:|Internal Server Error|Код запроса:/);
 await page.screenshot({path:`${output}/${file}.png`,animations:"disabled"});
 records=records.filter(r=>r.file!==`${file}.png`);records.push({file:`${file}.png`,description,mode:"DEMO · синтетика crm_demo; без новых внешних вызовов",date:new Date().toISOString(),sha,viewport:page.viewportSize(),url:new URL(page.url()).pathname+new URL(page.url()).search,sha256:createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex")});
 await writeFile(`${output}/manifest.json`,JSON.stringify(records,null,2)+"\n");console.log(`Captured ${file}`);
}
try{
 await login();
 const mode=process.argv[2]??"inspect";
 if(mode==="inspect"){
  for(const [name,url] of [["calendar","/calendar"],["task",`/tasks/${id("v31:task:1")}`],["collections","/collections"],["templates","/templates"],["client",`/clients/${id("client:0")}?tab=history`]]){
   await go(url);await writeFile(`data/v31-shots/${name}.txt`,await page.locator("body").innerText());console.log(name+": "+(await page.locator("h1").first().innerText()));
  }
 }
 if(mode==="planner"){
  await go("/calendar");await page.getByLabel("Охват",{exact:true}).selectOption("all");
  for(const [button,file] of [["День","planner-day"],["Неделя","planner-week"],["Месяц","planner-month"],["Три месяца","planner-3months"]]){
   await page.getByRole("button",{name:button,exact:true}).click();await expect(page.getByText("Загрузка календаря…",{exact:true})).toHaveCount(0);await expect(page.locator(".fc-event").first()).toBeVisible();await shot(file,`Планер: ${button}, цвета и легенда`);
  }
  await page.getByRole("button",{name:"Неделя",exact:true}).click();await page.getByLabel("Охват",{exact:true}).selectOption("employee");
  const employee=page.getByLabel("Сотрудник",{exact:true});await employee.selectOption({index:1});await expect(page.getByText("Загрузка календаря…",{exact:true})).toHaveCount(0);await shot("planner-filters-employee","Фильтр по сотруднику");
  await page.setViewportSize({width:390,height:900});await page.getByRole("button",{name:"День",exact:true}).click();await shot("mobile-planner","Мобильный планер 390 px");
 }
 if(mode==="tasks"){
  await go(`/tasks/${id("v31:task:1")}`);await shot("task-checklist","Чек-лист, сроки и прогресс");
  await page.getByRole("button",{name:"Выполнить",exact:true}).click();console.log((await page.getByRole("dialog").innerText()).slice(0,1500));
 }
 if(mode==="collections"){
  await go("/collections");await expect(page.locator('[data-collection-ready="true"]')).toBeVisible();await shot("collections-list","Именованные подборки с клиентом и без клиента");
  await go(`/collections/${id("v31:collection:1")}`);await expect(page.locator("article")).toHaveCount(3);await shot("collection-detail","Состав, комментарии, статусы и связь с потребностью");
  await go(`/collections/${id("v31:collection:0")}`);await page.getByPlaceholder("Найти потребность по названию").focus();await shot("collection-link-need","Выбор потребности для независимой подборки");
 }
 if(mode==="calls"){
  await go("/today");await page.getByRole("button",{name:"Записать звонок",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await shot("call-log-form","Ручная регистрация звонка");console.log((await page.getByRole("dialog").innerText()).slice(0,1800));
 }
 if(mode==="templates"){
  await go("/templates");await shot("templates-list","Четыре режима шаблонизатора, текущие версии");
  const row=page.locator("tr").filter({hasText:"DEMO · Карточка клиента"});await row.getByRole("link",{name:"История и поля"}).click();await shot("template-versions","История двух версий и манифест");
  await go(`/clients/${id("client:0")}`);await page.getByRole("button",{name:"Сформировать по шаблону",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await shot("template-preview","Проверка исходной записи и явное подтверждение формирования");
 }
 if(mode==="chat"){
  await login("REALTOR1");await go(`/clients/${id("client:0")}`);await page.getByRole("button",{name:"Открыть AI-помощника"}).click();await page.getByLabel("История диалогов").selectOption(id("v31:chat"));await expect(page.getByText(/DEMO-провайдер \(/)).toBeVisible();await shot("ai-chat-panel","Личная история DEMO-провайдера, без внешнего вызова");await page.getByRole("button",{name:"Подтвердить",exact:true}).scrollIntoViewIfNeeded();await shot("ai-chat-draft-confirm","Предпросмотр черновика перед явным подтверждением");
 }
 console.log("Browser errors: "+errors.length);await writeFile("data/v31-shots/browser-errors.json",JSON.stringify(errors));
}finally{await browser.close();}
