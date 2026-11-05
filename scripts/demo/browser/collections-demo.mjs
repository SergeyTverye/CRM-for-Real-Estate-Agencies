import { chromium, expect as baseExpect } from "@playwright/test";
import { parse } from "dotenv";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
const expect = baseExpect.configure({ timeout: 60000 });
const baseURL = "http://localhost:3408", output = "D:/crm-review/collections-v31";
const env = parse(readFileSync(".env"));
mkdirSync(output, { recursive: true });
const database = new pg.Client({ connectionString: "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo" });
await database.connect();
const browser = await chromium.launch({ headless: true });
let collectionId, offerId;
const checks = [], errors = [];
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post("/api/v1/auth/login", { headers: { origin: baseURL }, data: { login: env.SEED_REALTOR1_LOGIN ?? "realtor1", password: env.SEED_REALTOR1_PASSWORD } });
  expect(login.ok()).toBe(true);
  const page = await context.newPage(); page.setDefaultTimeout(60000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error") console.log("browser console:", message.text().slice(0, 400)); });
  await page.goto("/collections", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("textbox", { name: "Название подборки" }).fill("AT-10 DEMO Именованная подборка");
  await page.getByRole("button", { name: "Создать подборку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AT-10 DEMO Именованная подборка", exact: true })).toBeVisible({ timeout: 60000 });
  collectionId = page.url().split("/").at(-1); checks.push("create without client");
  const props = await (await context.request.get("/api/v1/properties/pick")).json(); expect(props.items.length).toBeGreaterThan(0);
  const listings = await database.query("SELECT id FROM external_listings ORDER BY id LIMIT 1"); expect(listings.rows.length).toBe(1);
  const initial = await database.query("SELECT (SELECT count(*) FROM properties)::int AS properties, (SELECT count(*) FROM need_property_matches)::int AS matches");
  const add = await context.request.post(`/api/v1/collections/${collectionId}/items`, { headers: { origin: baseURL }, data: { items: [{ propertyId: props.items[0].id }, { externalListingId: listings.rows[0].id }] } }); expect(add.ok()).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.locator('[data-collection-ready="true"]')).toBeVisible(); await expect(page.locator("article")).toHaveCount(2); checks.push("mixed items");
  const original = await (await context.request.get(`/api/v1/collections/${collectionId}`)).json();
  await page.getByRole("button", { name: "Ниже", exact: true }).first().click();
  await expect.poll(async () => (await (await context.request.get(`/api/v1/collections/${collectionId}`)).json()).items[0].id).toBe(original.items[1].id); checks.push("reorder arrows");
  const picker = page.getByPlaceholder("Найти потребность по названию"); await picker.focus();
  const needs = await (await context.request.get("/api/v1/property-search/pick-needs")).json(); expect(needs.items.length).toBeGreaterThan(0);
  // The API returns only scoped names; choose the visible first option in the real picker.
  await page.getByRole("button").filter({ hasText: needs.items[0].label }).first().click();
  await page.getByRole("button", { name: "Привязать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Отвязать", exact: true })).toBeVisible(); checks.push("named need picker / link");
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "Экспорт XLSX" }).click(); expect((await download).suggestedFilename()).toBe("collection.xlsx"); checks.push("XLSX download");
  const card = await (await context.request.get(`/api/v1/collections/${collectionId}`)).json();
  const crmIndex = card.items.findIndex(i => i.propertyId);
  await page.locator("article").nth(crmIndex).getByRole("checkbox").check();
  await page.getByRole("combobox", { name: "Потребность для предложения" }).selectOption(needs.items[0].id);
  await page.getByRole("button", { name: "Создать КП из выбранных" }).click();
  await page.waitForURL(/\/offers\/[0-9a-f-]+$/, { timeout: 60000 }); offerId = page.url().split("/").at(-1); checks.push("offer snapshot");
  const after = await database.query("SELECT (SELECT count(*) FROM properties)::int AS properties, (SELECT count(*) FROM need_property_matches)::int AS matches"); expect(after.rows).toEqual(initial.rows); checks.push("no implicit Property or Match");
  await page.goto(`/needs/${needs.items[0].id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "AT-10 DEMO Именованная подборка", exact: true })).toBeVisible(); checks.push("need card collections block");
  await page.goto(`/collections/${collectionId}`, { waitUntil: "domcontentloaded" }); await expect(page.locator('[data-collection-ready="true"]')).toBeVisible(); await expect(page.locator("article")).toHaveCount(2); await page.screenshot({ path: `${output}/collection-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 }); await page.screenshot({ path: `${output}/collection-mobile.png`, fullPage: true });
  expect(errors).toEqual([]); writeFileSync(`${output}/result.json`, JSON.stringify({ checks, errors, mode: "crm_demo", date: new Date().toISOString() }, null, 2));
  console.log(`Collections browser PASS: ${checks.join(", ")}`);
} finally {
  // Remove only this run's synthetic rows; existing demo data remains intact.
  if (offerId) { await database.query("DELETE FROM commercial_offer_items WHERE commercial_offer_id=$1", [offerId]); await database.query("DELETE FROM commercial_offers WHERE id=$1", [offerId]); }
  if (collectionId) { await database.query("DELETE FROM property_collection_needs WHERE collection_id=$1", [collectionId]); await database.query("DELETE FROM property_collection_items WHERE collection_id=$1", [collectionId]); await database.query("DELETE FROM property_collections WHERE id=$1", [collectionId]); }
  await database.end(); await browser.close();
}
