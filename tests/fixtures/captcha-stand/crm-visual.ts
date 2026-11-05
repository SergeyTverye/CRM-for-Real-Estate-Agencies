/** Optional visual QA against the prescribed demo DB/dev server. Never calls external sources. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { db, disconnectDb } from "@/shared/db/client";

async function main() {
  if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/crm_demo") throw new Error("DEMO_DATABASE_REQUIRED");
  const base = "http://localhost:3403", runId = randomUUID(), sessionId = randomUUID();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SCRAPER_CHROME_PATH });
  try {
    const login = process.env.SEED_MANAGER_LOGIN, password = process.env.SEED_MANAGER_PASSWORD;
    if (!login || !password) throw new Error("DEMO_CREDENTIALS_REQUIRED");
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const response = await context.request.post(`${base}/api/v1/auth/login`, { headers: { origin: base }, data: { login, password } });
    if (!response.ok()) throw new Error("DEMO_LOGIN_FAILED");
    const owner = await db.user.findUniqueOrThrow({ where: { login }, select: { id: true } });
    await db.searchRun.create({ data: { id: runId, userId: owner.id, filters: {}, status: "success" } });
    await db.interactiveBrowserSession.create({ data: { id: sessionId, searchRunId: runId, ownerUserId: owner.id, source: "cian", status: "cancelled", startUrlHost: "www.cian.ru", expiresAt: new Date(Date.now() + 60_000), completedAt: new Date(), closeReason: "user_cancelled" } });
    const page = await context.newPage();
    await page.goto(`${base}/browser-sessions/${sessionId}`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByRole("status").filter({ hasText: "Сеанс отменён" }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: "docs/integrations/captcha-hitl-crm-demo.png", fullPage: true });
    process.stdout.write('CRM_DEMO_CANCELLED_VIEW_PASS\n');
  } finally {
    for (const context of browser.contexts()) await context.request.post(`${base}/api/v1/auth/logout`, { headers: { origin: base } }).catch(() => undefined);
    await browser.close();
    await db.interactiveBrowserSession.deleteMany({ where: { id: sessionId } });
    await db.searchRun.deleteMany({ where: { id: runId } });
    await disconnectDb();
  }
}
void main().catch(() => { process.stdout.write("CRM_DEMO_VISUAL_UNAVAILABLE\n"); process.exitCode = 1; });
