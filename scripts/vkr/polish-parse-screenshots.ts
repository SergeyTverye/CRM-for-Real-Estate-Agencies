/** Four explicitly authorized parse calls, no web/scraper calls. Never retry a paid request. */
import { chromium, expect } from "@playwright/test";
import { config } from "dotenv";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, disconnectDb } from "../../src/shared/db/client";
import { execFileSync } from "node:child_process";

async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const baseURL = "http://localhost:3390";
  const output = "docs/screenshots/vkr/live-ai";
  const ledgerFile = "data/polish-parse-calls.json";
  const ledger = JSON.parse(await readFile(ledgerFile, "utf8").catch(() => "[]"));
  if (ledger.length && (process.argv[2] !== "resume-unbilled" || ledger.some((r: {http: number}) => r.http !== 409))) throw new Error("Paid calls are never retried automatically.");
  process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
  const old = JSON.parse(await readFile("data/live-ai-trials-state.json", "utf8"));
  const events = old.events.filter((e: { type: string }) => e.type === "parse");
  expect(events).toHaveLength(4);
  const browser = await chromium.launch();
  const managerContext = await browser.newContext({ baseURL });
  const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
  // All search invocations are forbidden, including manual fallback.
  await context.route(/\/api\/v1\/property-search\/runs/, route => route.request().method() === "GET" ? route.continue() : route.abort("blockedbyclient"));
  async function login(ctx: typeof context, role: "MANAGER" | "REALTOR1") {
    const r = await ctx.request.post("/api/v1/auth/login", { headers: { Origin: baseURL }, data: {
      login: process.env[`SEED_${role}_LOGIN`] ?? role.toLowerCase(), password: process.env[`SEED_${role}_PASSWORD`],
    } }); expect(r.ok()).toBeTruthy();
  }
  async function setting() { const r = await managerContext.request.get("/api/v1/settings/ai"); expect(r.ok()).toBeTruthy(); return (await r.json()).setting; }
  async function update(s: Record<string, unknown>, overrides: Record<string, unknown>) {
    const { id, updatedBy, updatedAt, ...input } = s; void id; void updatedBy;
    const r = await managerContext.request.put("/api/v1/settings/ai", { headers: { Origin: baseURL }, data: { ...input, expectedUpdatedAt: updatedAt, ...overrides } });
    expect(r.ok()).toBeTruthy(); return r.json();
  }
  const files = [["01-query", "02-ai-parsed-filters"], ["12-rent-query", "13-rent-parsed"], ["14-refinement-query", "15-refinement-parsed"], ["16-warehouse-query", "17-warehouse-parsed"]];
  const records = JSON.parse(await readFile("data/polish-screenshots-records.json", "utf8"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  async function shot(file: string, time: string, after: boolean) {
    for (let i = 0; i < 5 && await page.getByRole("button", { name: "Закрыть уведомление", exact: true }).count(); i++) await page.getByRole("button", { name: "Закрыть уведомление", exact: true }).first().click();
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.evaluate(async label => {
      await document.fonts.ready; window.scrollTo(0, 0);
      document.querySelector("#capture-provenance")?.remove();
      const el = document.createElement("div"); el.id = "capture-provenance"; el.textContent = label;
      Object.assign(el.style, { position: "fixed", bottom: "0", left: "0", right: "0", padding: "8px 16px", zIndex: "2147483647", background: "#172b3e", color: "white", font: "12px Arial", textAlign: "center" }); document.body.append(el);
    }, `LIVE · ${after ? "новый parse-вызов" : "запрос перед parse"} · ${time} · веб-поиск не выполняется`);
    await page.screenshot({ path: `${output}/${file}.png`, animations: "disabled" });
    const record = { file: `live-ai/${file}.png`, scenario: after ? "Новый LIVE parse русского запроса" : "Русский запрос перед новым LIVE parse", date: new Date().toISOString(), sourceTime: time, sha, role: "realtor1", url: new URL(page.url()).pathname, mode: "LIVE new parse; no web", sha256: createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex") };
    const previous = records.findIndex((r: { file: string }) => r.file === record.file); if (previous >= 0) records.splice(previous, 1); records.push(record);
    await writeFile("data/polish-screenshots-records.json", JSON.stringify(records, null, 2) + "\n");
    console.log(`Captured ${file}`);
  }
  let original: Record<string, unknown> | undefined;
  try {
    await login(managerContext, "MANAGER"); await login(context, "REALTOR1");
    original = await setting(); await writeFile("data/polish-original-ai-setting.json", JSON.stringify(original, null, 2));
    const since = new Date("2026-11-04T17:00:00Z");
    const user = await db.user.findUniqueOrThrow({ where: { login: process.env.SEED_REALTOR1_LOGIN ?? "realtor1" }, select: {id:true} });
    const userCalls = await db.aiUsageLog.count({where:{userId:user.id,createdAt:{gte:since}}});
    const dayCalls = await db.aiUsageLog.count({where:{createdAt:{gte:since}}});
    await disconnectDb();
    await update(original!, { perUserDailyLimit: Math.max(Number(original!.perUserDailyLimit), userCalls + 4), dailyLimit: Math.max(Number(original!.dailyLimit), dayCalls + 4), aiEnabled: true, monthlyBudgetRub: "250", webSearchManualAllowed: false, webSearchAutoFallback: false });
    const settingsPage = await managerContext.newPage(); await settingsPage.goto(`${baseURL}/settings/ai`);
    await page.goto(`/property-search?needId=${old.needId}`);
    await page.waitForFunction(() => Object.keys(document.querySelector("#query") ?? {}).some(k => k.startsWith("__reactProps")));
    for (let i = 0; i < 4; i++) {
      const query = events[i].query;
      await page.getByLabel("Опишите объект на русском", { exact: true }).fill(query);
      await shot(files[i]![0]!, new Date().toISOString(), false);
      const attemptIndex = ledger.length;
      ledger.push({ time: new Date().toISOString(), query, status: "attempted", budgetRub: "250" });
      await writeFile(ledgerFile, JSON.stringify(ledger, null, 2));
      const response = page.waitForResponse(r => r.url().endsWith("/property-search/parse") && r.request().method() === "POST", { timeout: 90000 });
      await page.getByRole("button", { name: "Разобрать с ИИ", exact: true }).click();
      const r = await response; const result = await r.json();
      Object.assign(ledger[attemptIndex], { http: r.status(), result, completedAt: new Date().toISOString() });
      await writeFile(ledgerFile, JSON.stringify(ledger, null, 2));
      await appendFile("docs/vkr/live-ai-trials.md", `\n- Пересъёмка parse ${i + 1}/4, ${ledger[attemptIndex].completedAt}: HTTP ${r.status()}, mode=${result.mode ?? "unknown"}, input=${result.usage?.inputTokens ?? "unknown"}, output=${result.usage?.outputTokens ?? "unknown"}, web=${result.webSearchCalls ?? 0}. Запрос: «${query}». Ответ: ${JSON.stringify(result.filters ?? result.error)}.\n`);
      expect(r.ok()).toBeTruthy(); expect(result.mode).toBe("live"); expect(result.webSearchCalls ?? 0).toBe(0);
      await expect(page.getByRole("button", { name: "Разобрать с ИИ", exact: true })).toBeEnabled();
      await shot(files[i]![1]!, ledger[attemptIndex].completedAt, true);
    }
  } finally {
    if (original) { const now = await setting(); await update({ ...original, updatedAt: now.updatedAt }, {}); await appendFile("docs/vkr/live-ai-trials.md", `\nНастройки восстановлены через /api/v1/settings/ai ${new Date().toISOString()}; бюджет ${original.monthlyBudgetRub} ₽. Скрапер и web в процессе пересъёмки были выключены через ENV.\n`); }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
