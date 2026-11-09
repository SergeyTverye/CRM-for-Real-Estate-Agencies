import { chromium, expect } from "@playwright/test";
import { parse } from "dotenv";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
const baseURL = "http://localhost:3406", output = "D:/crm-review/planner-v31";
const env = parse(readFileSync(".env"));
mkdirSync(output,{ recursive:true });
const database = new pg.Client({ connectionString:"postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo" });
await database.connect();
if (!(await database.query("SELECT 1 FROM clients WHERE notes LIKE '%DEMO-V241%' LIMIT 1")).rowCount) throw new Error("DEMO data required");
const browser = await chromium.launch({ headless:true });
const taskIds = [], eventIds = [], batchIds = [], errors = [], checks = [];
let page, stage = "login";
try {
  const context = await browser.newContext({ baseURL,viewport:{ width:1600,height:1100 } });
  const login = await context.request.post("/api/v1/auth/login",{ headers:{ origin:baseURL },data:{ login:env.SEED_REALTOR1_LOGIN ?? "realtor1",password:env.SEED_REALTOR1_PASSWORD } });
  expect(login.ok()).toBe(true);
  const now = Date.now();
  for (const [tone,hours,priority] of [["красный",-1,"normal"],["жёлтый",1,"normal"],["зелёный",25,"normal"],["серый",2,"normal"]]) {
    const res = await context.request.post("/api/v1/tasks",{ headers:{ origin:baseURL },data:{ title:`PL31 DEMO ${tone}`,taskType:"other",dueAt:new Date(now+hours*3600000).toISOString(),priority } });
    expect(res.ok()).toBe(true); const task = await res.json(); taskIds.push(task.id);
    if (tone === "серый") { const row = await (await context.request.get(`/api/v1/tasks/${task.id}`)).json(); expect((await context.request.post(`/api/v1/tasks/${task.id}/complete`,{ headers:{ origin:baseURL },data:{ expectedUpdatedAt:row.updatedAt } })).ok()).toBe(true); }
  }
  page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto("/today"); await expect(page.getByRole("link",{ name:"Планер: день / неделя / месяц / три месяца" })).toBeVisible(); checks.push("today entry");
  await page.goto("/calendar"); await expect(page.getByRole("heading",{ name:"Планер",exact:true })).toBeVisible();
  await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
  await expect(page.locator(".fc-event").filter({ hasText:"PL31 DEMO зелёный" })).toBeVisible({ timeout:60000 });
  for (const [label,color] of [["красный","rgb(185, 28, 28)"],["жёлтый","rgb(161, 98, 7)"],["зелёный","rgb(21, 128, 61)"],["серый","rgb(100, 116, 139)"]]) {
    const event = page.locator(".fc-event").filter({ hasText:`PL31 DEMO ${label}` }).first(); await expect(event).toBeVisible(); await expect(event).toHaveCSS("background-color",color);
  }
  await page.screenshot({ path:`${output}/week.png`,fullPage:true }); checks.push("week / four colors");
  await page.locator(".fc-timeGridDay-button").click(); await expect(page.locator(".fc-timeGridDay-view")).toBeVisible(); await expect(page.getByText("Загрузка календаря…",{ exact:true })).toBeHidden(); await page.screenshot({ path:`${output}/day.png`,fullPage:true }); checks.push("day");
  await page.locator(".fc-dayGridMonth-button").click(); await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible(); await expect(page.getByText("Загрузка календаря…",{ exact:true })).toBeHidden(); await page.screenshot({ path:`${output}/month.png`,fullPage:true }); checks.push("month");
  stage = "quarter aggregate";
  const requests = [];
  page.on("request", req => { if (req.url().includes("/api/v1/calendar?")) requests.push(req.url()); });
  const aggregateResponse = page.waitForResponse(r => r.url().includes("/api/v1/calendar/aggregate?") && r.status() === 200);
  await page.locator(".fc-dayGridQuarter-button").click();
  const data = await (await aggregateResponse).json(); expect(data.days.length).toBeLessThanOrEqual(100); expect(data.days.length).toBeGreaterThan(0);
  expect(data).not.toHaveProperty("items"); expect(requests).toEqual([]);
  await expect(page.locator(".fc-dayGridQuarter-view")).toBeVisible(); await page.screenshot({ path:`${output}/three-months.png`,fullPage:true }); checks.push("three months / server aggregate only");
  const dayResponse = page.waitForResponse(r => r.url().includes("/api/v1/calendar?") && r.status() === 200);
  await page.locator(".fc-dayGridQuarter-view .fc-event").first().click(); await dayResponse;
  await expect(page.locator(".fc-timeGridDay-view")).toBeVisible(); checks.push("lazy selected day");
  await page.getByText("Мини-календарь",{ exact:true }).click(); await expect(page.getByRole("button",{ name:"Предыдущий месяц мини-календаря" })).toBeVisible(); checks.push("mini calendar");
  stage = "checklist";
  await page.goto(`/tasks/${taskIds[1]}`); await page.getByRole("button",{ name:"+ Пункт",exact:true }).click();
  const dialog = page.getByRole("dialog",{ name:"Новый пункт" }); await dialog.getByRole("textbox",{ name:"Название" }).fill("PL31 обязательный пункт"); await dialog.getByRole("checkbox",{ name:"Обязательный пункт" }).check();
  await dialog.getByRole("button",{ name:"Сохранить пункт" }).click(); await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByText("PL31 обязательный пункт",{ exact:true })).toBeVisible();
  const task = await (await context.request.get(`/api/v1/tasks/${taskIds[1]}`)).json();
  const rejected = await context.request.post(`/api/v1/tasks/${taskIds[1]}/complete`,{ headers:{ origin:baseURL },data:{ expectedUpdatedAt:task.updatedAt } });
  expect(rejected.status()).toBe(422); expect((await rejected.json()).error.code).toBe("OPEN_REQUIRED_CHECKLIST"); checks.push("checklist required warning");
  await page.getByRole("button",{ name:"Выполнить",exact:true }).click();
  const completion = page.getByRole("dialog",{ name:"Выполнение задачи",exact:true });
  await completion.getByRole("button",{ name:"Выполнено",exact:true }).click();
  await expect(completion.getByRole("checkbox",{ name:"Завершить с открытыми обязательными пунктами" })).toBeVisible();
  await completion.getByRole("checkbox",{ name:"Завершить с открытыми обязательными пунктами" }).check();
  await completion.getByRole("button",{ name:"Выполнено",exact:true }).click(); await expect(completion).toBeHidden();
  expect((await (await context.request.get(`/api/v1/tasks/${taskIds[1]}`)).json()).status).toBe("completed"); checks.push("explicit checklist confirmation dialog");
  stage = "bulk preview and confirm";
  const clients = await (await context.request.get("/api/v1/clients?pageSize=20")).json();
  await page.goto("/tasks"); await page.getByRole("button",{ name:"Массовые задачи",exact:true }).click();
  const bulk = page.getByRole("dialog",{ name:"Задачи выбранным клиентам",exact:true });
  await bulk.getByRole("textbox",{ name:"Клиенты (до 100)" }).fill(clients.items[0].displayName);
  await bulk.getByRole("button",{ name:clients.items[0].displayName,exact:true }).click();
  const bulkTitle = `PL31 bulk ${Date.now()}`;
  await bulk.getByRole("textbox",{ name:"Что сделать" }).fill(bulkTitle);
  await bulk.locator('input[type="datetime-local"]').fill("2026-11-12T10:00");
  await bulk.getByRole("button",{ name:"Предпросмотр",exact:true }).click();
  await expect(bulk.getByText("Будет создано задач: 1.",{ exact:false })).toBeVisible({ timeout:30000 });
  expect((await database.query("SELECT id FROM tasks WHERE title=$1",[bulkTitle])).rowCount).toBe(0);
  const bulkResponse = page.waitForResponse(r => r.url().endsWith("/api/v1/tasks/bulk") && r.request().postDataJSON()?.confirmed === true);
  await bulk.getByRole("button",{ name:"Подтвердить создание",exact:true }).click();
  const batch = await (await bulkResponse).json(); batchIds.push(batch.batchId);
  taskIds.push(...(await database.query("SELECT id FROM tasks WHERE bulk_batch_id=$1",[batch.batchId])).rows.map(row => row.id));
  await expect(bulk).toBeHidden(); await expect(page.getByText("Создано задач: 1",{ exact:true })).toBeVisible(); checks.push("bulk preview writes nothing / explicit confirmation");
  expect(errors).toEqual([]);
  writeFileSync(`${output}/result.json`,JSON.stringify({ mode:"DEMO",checks,errors,screenshots:4,date:new Date().toISOString() },null,2));
  console.log(`planner DEMO browser PASS: ${checks.join(", ")}`);
} catch(error) {
  if (page) await page.screenshot({ path:`${output}/failure.png`,fullPage:true }).catch(() => {});
  console.error(`planner DEMO browser failed at ${stage}`); throw error;
} finally {
  await database.query("DELETE FROM task_checklist_items WHERE task_id=ANY($1::uuid[])",[taskIds]);
  await database.query("DELETE FROM task_clients WHERE task_id=ANY($1::uuid[])",[taskIds]);
  await database.query("DELETE FROM tasks WHERE id=ANY($1::uuid[])",[taskIds]);
  await database.query("DELETE FROM bulk_task_batches WHERE id=ANY($1::uuid[])",[batchIds]);
  await database.query("DELETE FROM calendar_events WHERE id=ANY($1::uuid[])",[eventIds]);
  await database.end(); await browser.close();
}
