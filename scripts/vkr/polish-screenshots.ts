import { chromium, expect, type Locator } from "@playwright/test";
import { config } from "dotenv";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

async function main() {
config({ path: [".env.local", ".env"], quiet: true });
const baseURL = process.env.VKR_BASE_URL ?? "http://localhost:3395";
const finalOnly = ["final-only", "final-live-only"].includes(process.argv[2] ?? "");
const output = "docs/screenshots/vkr";
const evidence = JSON.parse(await readFile("docs/vkr/live-ai-evidence.json", "utf8"));
const state = JSON.parse(await readFile("data/live-ai-trials-state.json", "utf8"));
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
const records: Record<string, unknown>[] = JSON.parse(await readFile("data/polish-screenshots-records.json", "utf8").catch(() => "[]"));
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 1000 } });
await context.route(/\/api\/v1\/(ai\/|property-search\/)/, route =>
  route.request().method() === "GET" ? route.continue() : route.abort("blockedbyclient"));
const page = await context.newPage();
let focusTarget: Locator | undefined;
page.on("pageerror", error => console.log(`Browser error: ${error.message.slice(0, 250)}`));
page.setDefaultTimeout(60000);
async function login() {
  await page.goto("/login");
  const result = await page.request.post("/api/v1/auth/login", { headers: { Origin: baseURL }, data: {
    login: process.env.SEED_REALTOR1_LOGIN ?? "realtor1", password: process.env.SEED_REALTOR1_PASSWORD,
  } });
  expect(result.ok()).toBeTruthy();
}
async function navigate(url: string) {
  focusTarget = undefined;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Application error:|Internal Server Error|Запись не найдена или недоступна/);
  await expect(page.getByText("Загрузка...", { exact: true })).toHaveCount(0);
}
async function shot(file: string, scenario: string, runId?: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Загрузка фотографии…", { exact: true })).toHaveCount(0, { timeout: 30000 });
  await page.evaluate(() => Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); }))));
  if (focusTarget) await focusTarget.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 90));
  for (let i = 0; i < 5 && await page.getByRole("button", { name: "Закрыть уведомление", exact: true }).count(); i++)
    await page.getByRole("button", { name: "Закрыть уведомление", exact: true }).first().click();
  await expect(page.locator(".toast")).toHaveCount(0);
  const live = file.startsWith("live-ai/");
  const run = evidence.runs.find((r: { id: string }) => r.id === runId);
  const sourceTime = run?.time ?? evidence.exportedAt;
  if (live) {
    await page.evaluate(label => {
      document.querySelector("#capture-provenance")?.remove();
      const el = document.createElement("div"); el.id = "capture-provenance"; el.textContent = label;
      Object.assign(el.style, { position: "fixed", bottom: "0", left: "0", right: "0", padding: "8px 16px", zIndex: "2147483647", background: "#172b3e", color: "white", font: "12px Arial", textAlign: "center" });
      document.body.append(el);
    }, process.argv[2] === "purpose-rule-only"
      ? `Сохранённые LIVE-данные ${sourceTime} · офлайн-переоценка назначения · AI выключен, новых вызовов нет`
      : `LIVE-данные, сохранённые при испытании ${sourceTime}, кадр переснят без новых вызовов`);
  }
  await page.screenshot({ path: `${output}/${file}.png`, animations: "disabled", fullPage });
  const record = { file: `${file}.png`, scenario, date: new Date().toISOString(), sha, role: "realtor1", url: new URL(page.url()).pathname + new URL(page.url()).search,
    mode: live ? "LIVE saved replay; AI_ENABLED=false; no new calls" : "DEMO; crm_demo; AI_ENABLED=false", sourceTime: live ? sourceTime : undefined,
    runId, sha256: createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex") };
  const previous = records.findIndex(r => r.file === record.file);
  if (previous >= 0) records.splice(previous, 1);
  records.push(record);
  await writeFile("data/polish-screenshots-records.json", JSON.stringify(records, null, 2) + "\n");
  console.log(`Captured ${file}`);
}
async function run(id: string) {
  await navigate(`/property-search?runId=${id}`);
  await expect(page.getByRole("heading", { name: "Состояние источников", exact: true })).toBeVisible();
  await page.waitForFunction(() => Object.keys(document.querySelector("#query") ?? {}).some(k => k.startsWith("__reactProps")));
}
async function focus(locator: Locator) {
  focusTarget = locator;
  await locator.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 90));
}
try {
  await mkdir("data/polish-offer", { recursive: true });
  await login();
  if (process.argv[2] === "purpose-rule-only") {
    const id = evidence.runs[0].id;
    await run(id);
    await page.getByRole("tab", { name: "Исключены", exact: true }).click();
    await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
    await shot("live-ai/04-live-results", "Сохранённая LIVE выдача после офлайн-переоценки назначения; исходно жилые объявления были needs_review", id);
    const evidenceBlock = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Доказательства по критериям/ }) })
      .filter({ hasText: /Квартира в квартале бизнес-класса|жилой комплекс комфорт-класса/ }).first();
    await expect(evidenceBlock).toBeAttached();
    await evidenceBlock.locator("summary").click();
    await expect(evidenceBlock).toContainText(/Назначение/);
    await focus(evidenceBlock);
    await shot("live-ai/05-evidence", "Противоречие назначения: жилое объявление, детерминированное правило и исходный evidence-фрагмент", id);
    return;
  }
  if (process.argv[2] === "details-only") {
    const ids = evidence.runs.map((r: { id: string }) => r.id);
    await run(ids[0]);
    await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    const detail = page.getByText(/^Доказательства по критериям/).first();
    await detail.click(); await focus(detail);
    await shot("live-ai/05-evidence", "Сохранённые доказательства критериев", ids[0]);
    await page.getByRole("tab", { name: "Закладки", exact: true }).click();
    await expect(page.getByRole("link", { name: "Источник ↗", exact: true }).first()).toBeVisible();
    await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
    await shot("live-ai/08-bookmarks", "Сохранённые закладки LIVE", ids[0]);
    await run(ids[7]);
    await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    await expect(page.getByLabel("Сравнить объявление", { exact: true }).first()).toBeVisible();
    await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
    await shot("live-ai/36-preserved-after-restart", "Сохранённые результаты запуска доступны после рестарта без AI", ids[7]);
    return;
  }
  const demoOffer = manifest.find((r: { file: string }) => r.file === "10-offer.png").url;
  if (!["live-only", "final-live-only"].includes(process.argv[2] ?? "")) {
    await navigate(demoOffer); await shot("10-offer", "DEMO КП из трёх объектов со снимками");
    const pdf = await page.request.get(`/api/v1${demoOffer}/pdf`);
    expect(pdf.ok()).toBeTruthy(); await writeFile("data/polish-offer/demo.pdf", await pdf.body());
    execFileSync("pdftoppm", ["-scale-to", "1600", "-png", "data/polish-offer/demo.pdf", "data/polish-offer/page"]);
    for (const [n, file] of [[1, "10c-offer-pdf-page1"], [2, "10d-offer-pdf-page2"]] as const) {
      await copyFile(`data/polish-offer/page-${n}.png`, `${output}/${file}.png`);
      const previous = records.findIndex(r => r.file === `${file}.png`);
      if (previous >= 0) records.splice(previous, 1);
      records.push({ file: `${file}.png`, scenario: `DEMO A4 PDF страница ${n}`, date: new Date().toISOString(), sha, role: "realtor1", url: `/api/v1${demoOffer}/pdf`, mode: "DEMO; Poppler render", sha256: createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex") });
    }
    await navigate(`${demoOffer}/print`);
    await expect(page.frameLocator("iframe").locator("h1")).toBeVisible();
    await shot("10b-offer-print", "Титульная страница A4 и единая панель действий");
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Скачать DOCX");
      return button && Object.keys(button).some(k => k.startsWith("__reactProps"));
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать DOCX", exact: true }).click();
    await (await download).saveAs("data/polish-offer/demo.docx");
  }
  if (process.argv[2] === "demo-only") process.exitCode = 0;
  else {
    const ids = evidence.runs.map((r: { id: string }) => r.id);
    const plans = [
      ["04-live-results", ids[0]], ["06-source-statuses", ids[0]], ["19-rent-results", ids[1]],
      ["25-repeat-results", ids[2]], ["31-web-corrected", ids[7]],
      ["33-timeout-recovery", ids[6]], ["34-auto-web-cards", ids[8]], ["37-empty-live", ids[9]],
      ["30-empty-results", ids[5]],
    ];
    for (const [file, id] of plans) {
      if (finalOnly && !["04-live-results", "19-rent-results", "25-repeat-results"].includes(file)) continue;
      await run(id);
      await focus(page.getByRole("heading", { name: "Состояние источников", exact: true }));
      if (["04-live-results", "19-rent-results", "25-repeat-results"].includes(file)) {
        await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
        await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
      }
      await shot(`live-ai/${file}`, "Сохранённый результат LIVE SearchRun", id);
    }
    await run(ids[0]);
    await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    const compare = page.getByLabel("Сравнить объявление", { exact: true });
    await compare.nth(0).check(); await compare.nth(1).check();
    await page.getByRole("button", { name: "Сравнить", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Сравнение объявлений" })).toBeVisible();
    await shot("live-ai/26-comparison", "Сравнение двух сохранённых LIVE объявлений", ids[0]);
    await page.keyboard.press("Escape");
    const detail = page.getByText(/^Доказательства по критериям/).first();
    if (await detail.count()) { await detail.click(); await focus(detail); await shot("live-ai/05-evidence", "Сохранённые доказательства критериев", ids[0]); }
    if (finalOnly) return;
    await page.getByRole("tab", { name: "Закладки", exact: true }).click();
    await expect(page.getByRole("link", { name: "Источник ↗", exact: true }).first()).toBeVisible();
    await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
    await shot("live-ai/08-bookmarks", "Сохранённые закладки LIVE", ids[0]);
    await navigate(`/needs/${state.needId}`);
    await focus(page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }));
    await shot("live-ai/09-selection", "Сохранённая подборка LIVE", ids[0]);
    await navigate(`/offers/${state.offerId}`); await shot("live-ai/10-offer", "КП из сохранённой LIVE подборки", ids[0]);
    await navigate(`/offers/${state.offerId}/print`); await expect(page.frameLocator("iframe").locator("h1")).toBeVisible();
    await shot("live-ai/11-offer-print", "Печатный A4 сохранённого LIVE КП", ids[0]);
    await run(ids[7]); await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    await expect(page.getByLabel("Сравнить объявление", { exact: true }).first()).toBeVisible();
    await focus(page.getByRole("tablist", { name: "Результаты поиска" }));
    await shot("live-ai/36-preserved-after-restart", "Сохранённые результаты запуска доступны после рестарта без AI", ids[7]);
  }
} finally { await writeFile("data/polish-screenshots-records.json", JSON.stringify(records, null, 2) + "\n"); await browser.close(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
