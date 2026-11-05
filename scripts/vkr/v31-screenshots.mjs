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
await mkdir("data/v31-shots",{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({baseURL,viewport:{width:1440,height:900},locale:"ru-RU",timezoneId:"Asia/Novosibirsk"});
await context.routeWebSocket("**/_next/webpack-hmr*", ()=>{});
const page=await context.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);
// History/preview only: prevent accidental paid AI, web-search or scraper calls.
await context.route("**/api/v1/**",async route=>{
 const request=route.request(), path=new URL(request.url()).pathname;
 if(request.method()!=="GET" && /\/(?:ai|ai-chat|property-search)\//.test(path)) return route.abort("blockedbyclient");
 return route.continue();
});
page.on("dialog",dialog=>dialog.accept());
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
let records=[];try{records=JSON.parse(await readFile(`${output}/manifest.json`,"utf8"));}catch{}
let role="MANAGER";
async function login(role="MANAGER"){
 await context.request.post("/api/v1/auth/logout",{headers:{origin:baseURL}});
 const r=await context.request.post("/api/v1/auth/login",{headers:{origin:baseURL},data:{login:process.env[`SEED_${role}_LOGIN`]??role.toLowerCase(),password:process.env[`SEED_${role}_PASSWORD`]}});expect(r.ok()).toBeTruthy();
}
async function go(url){await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.locator("h1").first()).toBeVisible();await page.waitForLoadState("networkidle");}
async function click(name){ const button=page.getByRole("button",{name,exact:true});await expect.poll(()=>button.evaluate(el=>Object.keys(el).some(k=>k.startsWith("__reactProps") && typeof el[k]?.onClick === "function"))).toBe(true);await button.click(); }
async function shot(file,description){
 await page.locator('button[aria-label="Закрыть уведомление"]').evaluateAll(buttons=>buttons.forEach(b=>b.click()));
 await page.evaluate(async()=>{await document.fonts.ready;});
 await expect(page.locator("body")).not.toContainText(/Application error:|Internal Server Error|Код запроса:/);
 await page.screenshot({path:`${output}/${file}.png`,animations:"disabled"});
 records=records.filter(r=>r.file!==`${file}.png`);records.push({file:`${file}.png`,description,mode:"DEMO · синтетика crm_demo; без новых внешних вызовов",date:new Date().toISOString(),sha,workingTree:"uncommitted changes; base HEAD only",role,viewport:page.viewportSize(),url:new URL(page.url()).pathname+new URL(page.url()).search,sha256:createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex")});
 console.log(`Captured ${file}`);
 await writeFile(`data/v31-shots/${file}.json`,JSON.stringify(records.find(r=>r.file===`${file}.png`),null,2)+"\n");
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
  await go("/calendar");await expect(page.locator(".fc-toolbar")).toBeVisible();await page.getByText("Фильтры и быстрые действия",{exact:true}).click();await page.getByLabel("Охват",{exact:false}).selectOption("all");await expect(page.getByLabel("Охват",{exact:false})).toHaveValue("all");await page.waitForLoadState("networkidle");
  await page.getByText("Фильтры и быстрые действия",{exact:true}).click();
  for(const [button,file] of [["День","planner-day"],["Неделя","planner-week"],["Месяц","planner-month"],["Три месяца","planner-3months"]]){
   await page.getByRole("button",{name:button,exact:true}).click();await expect(page.getByText("Загрузка календаря…",{exact:true})).toHaveCount(0);await expect(page.locator(".fc-event").first()).toBeVisible();await shot(file,`Планер: ${button}, цвета и легенда`);
  }
  await page.getByRole("button",{name:"Неделя",exact:true}).click();await page.getByText("Фильтры и быстрые действия",{exact:true}).click();await page.getByLabel("Охват",{exact:false}).selectOption("employee");
  const employee=page.getByLabel("Сотрудник планера",{exact:true});const employeeId=await employee.locator("option").filter({hasText:"Риелтор 1"}).getAttribute("value");const employeeResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/calendar" && new URL(r.url()).searchParams.get("employee")===employeeId);await employee.selectOption(employeeId);const employeeData=await (await employeeResponse).json();await expect(page.getByRole("status").filter({hasText:"Событий в периоде:"})).toHaveText(`Событий в периоде: ${employeeData.items.length}.`);await expect(page.getByText("Загрузка календаря…",{exact:true})).toHaveCount(0);await expect(page.locator(".fc-toolbar")).toBeVisible();await expect(page.locator(".fc-event").first()).toBeVisible();await page.waitForLoadState("networkidle");await shot("planner-filters-employee","Фильтр по сотруднику");
  await page.getByText("Настройка близкого срока",{exact:true}).click();await page.getByLabel("Скоро, часов").fill("24");await shot("planner-settings-threshold","Порог близкого срока: 24 часа, форма руководителя без изменения настройки");
  await page.getByText("Настройка близкого срока",{exact:true}).click();
  await page.getByText("Фильтры и быстрые действия",{exact:true}).click();await page.setViewportSize({width:390,height:900});await page.getByRole("button",{name:"День",exact:true}).click();await expect(page.getByText("Загрузка календаря…",{exact:true})).toHaveCount(0);await expect(page.locator(".fc-event").first()).toBeVisible();await page.waitForLoadState("networkidle");await shot("mobile-planner","Мобильный планер 390 px");
 }
 if(mode==="tasks"){
  await context.request.post("/api/v1/tasks/bulk",{headers:{origin:baseURL},data:{}});await context.request.get("/tasks/new");
  await go(`/tasks/${id("v31:task:1")}`);await shot("task-checklist","Чек-лист, сроки и прогресс");
  await click("Выполнить");
  await page.getByRole("dialog").getByRole("button",{name:"Выполнено",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"Завершить с открытыми обязательными пунктами"})).toBeVisible();await shot("task-complete-warning","Сервер отклоняет завершение с обязательными открытыми пунктами; явное подтверждение ещё не дано");
  await go("/tasks");await click("Массовые задачи");
  const bulk=page.getByRole("dialog");
  for(const name of ["Сибирь Коммерция 1","Сибирь Коммерция 4"]){await bulk.getByRole("textbox",{name:"Клиенты (до 100)"}).fill(name);await bulk.getByRole("button",{name:`ООО «${name}»`,exact:true}).click();}
  await bulk.getByRole("textbox",{name:"Что сделать"}).fill("DEMO · Уточнить обратную связь по подборке");await bulk.locator('input[type="datetime-local"]').fill("2026-11-12T10:00");await bulk.getByRole("button",{name:"Предпросмотр",exact:true}).click();await expect(bulk.getByText(/Будет создано задач: 2/)).toBeVisible();await shot("bulk-tasks-preview","Предпросмотр двух задач; записи не создаются до подтверждения");
  await go("/tasks/new");await page.getByRole("button",{name:"Контроль договора",exact:true}).click();await page.locator('input[type="datetime-local"]').fill("2026-11-12T10:00");await shot("recurrence-quarter","Шаблон квартального контроля; следующий экземпляр создаётся при выполнении текущего");
 }
 if(mode==="recurrence"){
  await go("/tasks/new");await click("Контроль договора");await page.locator('input[type="datetime-local"]').fill("2026-11-12T10:00");await expect(page.getByRole("combobox",{name:"Повторять",exact:true})).toHaveValue("quarterly");await shot("recurrence-quarter","Квартальный контроль договора: следующий экземпляр после выполнения, форма без сохранения");
 }
 if(mode==="collections"){
  role="REALTOR1";await login(role);
  await go("/collections");await expect(page.getByRole("button",{name:"Создать подборку",exact:true})).toBeEnabled();await shot("collections-list","Именованные подборки с клиентом и без клиента");
  await go(`/collections/${id("v31:collection:1")}`);await expect(page.locator("article")).toHaveCount(3);await shot("collection-detail","Состав, комментарии, статусы и связь с потребностью");
  await go(`/collections/${id("v31:collection:0")}`);await expect(page.locator('[data-collection-ready="true"]')).toBeVisible();await page.getByPlaceholder("Найти потребность по названию").fill("Сибирь Коммерция 1");await expect(page.getByRole("button",{name:/Сибирь Коммерция 1/}).first()).toBeVisible();await shot("collection-link-need","Выбор потребности для независимой подборки; привязка ещё не выполнена");
 }
 if(mode==="calls"){
  await go("/today");await click("Записать звонок");const dialog=page.getByRole("dialog");await expect(dialog.getByLabel("Источник",{exact:false})).toBeVisible();await dialog.getByLabel("Источник",{exact:false}).selectOption("avito");await dialog.getByLabel("Кратко: что хотел клиент, о чём договорились",{exact:false}).fill("DEMO · Разовая консультация по стоимости аренды, подбор не требуется.");await shot("call-log-form","Ручной разовый звонок: источник и итог без создания клиента");
  await dialog.getByText("Ошибочное/спам",{exact:true}).click();await dialog.getByLabel("Результат звонка",{exact:false}).selectOption("spam");await dialog.getByLabel("Кратко: что хотел клиент, о чём договорились",{exact:false}).fill("DEMO · Рекламный звонок, спам. Продолжение не требуется.");await dialog.getByLabel("Контакт (как есть)",{exact:false}).fill("+7 900 000-99-99");await shot("call-log-spam","Спам без Client и потребности; форма до сохранения");
  await page.setViewportSize({width:390,height:900});await dialog.evaluate(el=>el.scrollTop=0);await shot("mobile-call-log","Ручная регистрация звонка на мобильном экране 390 px");await page.setViewportSize({width:1440,height:900});
  await go("/reports/sources?from=2026-11-01&to=2026-11-30");await shot("call-sources-stats","Источники и итоги звонков, числители и знаменатели на первичных синтетических записях");
 }
 if(mode==="timeline"){
  await go(`/clients/${id("client:0")}?tab=history`);await page.getByRole("heading",{name:"Текущие этапы потребностей",exact:true}).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-110));await shot("client-timeline","Таймлайн клиента: первичные события, документы, задачи, подборка");
  await go(`/clients/${id("client:0")}?tab=history&needId=${id("need:0")}`);await page.getByRole("heading",{name:"Текущие этапы потребностей",exact:true}).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-110));await shot("client-timeline-filtered-need","История по выбранной потребности клиента");
 }
 if(mode==="templates"){
  await go("/templates");await shot("templates-list","Четыре режима шаблонизатора, текущие версии");
  const row=page.locator("tr").filter({hasText:"DEMO · Карточка клиента"});await go(await row.getByRole("link",{name:"История и поля"}).getAttribute("href"));await shot("template-versions","История двух версий и манифест");
  await go(`/clients/${id("client:0")}`);await page.getByRole("button",{name:"Сформировать по шаблону",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await shot("template-preview","Проверка исходной записи и явное подтверждение формирования");
 }
 if(mode==="chat"){
  role="REALTOR1";await login(role);await go(`/clients/${id("client:0")}`);await click("Открыть AI-помощника");await page.getByLabel("История диалогов").selectOption(id("v31:chat"));await expect(page.getByText(/DEMO-провайдер \(/)).toBeVisible();await shot("ai-chat-panel","Личная история DEMO-провайдера, без внешнего вызова");await page.getByRole("button",{name:"Подтвердить",exact:true}).scrollIntoViewIfNeeded();await page.getByRole("button",{name:"Подтвердить",exact:true}).focus();await shot("ai-chat-draft-confirm","Предпросмотр черновика перед явным подтверждением; задача не создана");
 }
 expect(errors).toEqual([]);console.log("Browser errors: "+errors.length);await writeFile(`data/v31-shots/${mode}-browser-errors.json`,JSON.stringify(errors));
 // Manifest/checksums are finalized separately, preserving the search agent entries.
}catch(error){await page.screenshot({path:`data/v31-shots/${process.argv[2]}-failure.png`}).catch(()=>{});await writeFile(`data/v31-shots/${process.argv[2]}-failure.txt`,await page.locator("body").innerText()).catch(()=>{});throw error;}finally{await context.request.post("/api/v1/auth/logout",{headers:{origin:baseURL}}).catch(()=>{});await browser.close();}
