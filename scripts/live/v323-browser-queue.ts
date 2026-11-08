/** LIVE: real CRM HTTP queue + production worker, ordinary Chromium, <=60 page navigations.
 * Stores aggregate evidence only. No page HTML, contacts, tokens or listing URLs in report.
 * Run after next build with NEXT_DIST_DIR=.next-v323-captcha and crm_demo migration.
 */
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db, disconnectDb } from "../../src/shared/db/client";
import { createSession, revokeSession } from "../../src/modules/auth/application/session-service";
import type { Source } from "../../src/modules/property-search/domain/types";
import { chromium } from "playwright-core";

async function main() {
  if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/crm_demo") throw new Error("CRM_DEMO_REQUIRED");
  await mkdir("data", { recursive: true });
  if (await db.searchRun.count({ where: { status: { in: ["queued", "running"] } } })) throw new Error("DEMO_QUEUE_MUST_BE_IDLE");
  const before = await db.aiSetting.findFirstOrThrow();
  const user = await db.user.findFirstOrThrow({ where: { roleCode: "manager", isActive: true, mustChangePassword: false } });
  const session = await createSession(db, user.id, { userAgent: "v323-queue-live-synthetic", ip: "127.0.0.1" });
  const children: ChildProcess[] = [];
  const streams: ReturnType<typeof createWriteStream>[] = [];
  const base = "http://127.0.0.1:3383";
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", DEPLOYMENT_ID: process.env.DEPLOYMENT_ID ?? "00000000-0000-4000-8000-000000000001", INSTANCE_ID: process.env.INSTANCE_ID ?? "00000000-0000-4000-8000-000000000383", APP_TIMEZONE: "Asia/Novosibirsk", NEXT_DIST_DIR: ".next-v323-captcha", SCRAPER_ENABLED: "true", SCRAPER_BROWSER_ENABLED: "true", SCRAPER_CHROME_PATH: chromium.executablePath(), SCRAPER_BROWSER_EXECUTABLE_PATH: chromium.executablePath(), SCRAPER_DEMO_FIXTURES: "false", AI_ENABLED: "false", BROWSER_SESSION_ALLOWED_SOURCES: "cian,yandex", LOG_LEVEL: "warn" };
  const start = (name: string, args: string[]) => {
    const log = createWriteStream(`data/v323-${name}.log`); streams.push(log);
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout?.pipe(log); child.stderr?.pipe(log); children.push(child); return child;
  };
  const request = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(`${base}${url}`, { method, headers: { cookie: `crm_session=${session.token}`, origin: base, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`CRM_HTTP_${r.status}_${url.split("?")[0]}`);
    return r.json();
  };
  const results: unknown[] = [];
  let settingsUi = false;
  try {
    await db.aiSetting.update({ where: { id: before.id }, data: { scraperEnabled: true, browserEnabled: true, cianAutoBrowser: true, yandexAutoBrowser: true, enabledSources: ["cian", "yandex", "mirkvartir", "onrealt"], aiEnabled: false } });
    const server = start("server", ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3383"]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error("SERVER_EXITED");
      try { const r = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch { /* bounded startup */ }
      await delay(1000);
    }
    if (!ready) throw new Error("SERVER_NOT_READY");
    const settingsResponse = await fetch(`${base}/settings/sources`, { headers: { cookie: `crm_session=${session.token}` } });
    settingsUi = settingsResponse.ok && (await settingsResponse.text()).includes("Автоматическая проверка в браузере");
    if (!settingsUi) throw new Error("SETTINGS_UI_MISSING");
    start("worker", ["node_modules/tsx/dist/cli.mjs", "src/worker/property-search-worker.ts"]);
    for (const sources of [["cian"], ["yandex"], ["cian", "yandex", "mirkvartir", "onrealt"]] as Source[][]) {
      const started = Date.now();
      const run = await request("POST", "/api/v1/property-search/runs", { filters: { city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources }, sources, depth: { maxPages: 1, limit: 5 }, deadlineMs: 180000, confirmedPaid: false, idempotencyKey: `v323-browser-${randomUUID()}` });
      let progress;
      for (let tick = 0; tick < 190; tick++) {
        progress = await request("GET", `/api/v1/property-search/runs/${run.id}/progress`);
        if (!["queued", "running"].includes(progress.status)) break;
        await delay(1000);
      }
      if (!progress || ["queued", "running"].includes(progress.status)) { await request("POST", `/api/v1/property-search/runs/${run.id}/cancel`, {}); throw new Error("QUEUE_DEADLINE"); }
      const persisted = await db.searchRunResult.count({ where: { runId: run.id } });
      const rows = await db.searchRunSource.findMany({ where: { runId: run.id }, orderBy: { source: "asc" } });
      const result = { mode: "LIVE", runId: run.id, sources, status: progress.status, elapsedMs: Date.now() - started, persisted,
        sourceResults: rows.map(s => ({ source: s.source, status: s.status, saved: s.resultCount, durationMs: s.durationMs, pages: s.depthReached, needsUserAction: s.needsUserAction, reason: s.statusReasonRu })) };
      results.push(result); console.log(JSON.stringify(result));
      await delay(2000);
    }
  } finally {
    for (const child of children.reverse()) {
      if (child.exitCode !== null || !child.pid) continue;
      if (process.platform === "win32") await new Promise<void>(resolve => { const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); killer.on("exit", () => resolve()); killer.on("error", () => resolve()); });
      else { child.kill("SIGTERM"); await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), delay(5000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
    }
    for (const stream of streams) stream.end();
    await revokeSession(db, (await db.userSession.findUniqueOrThrow({ where: { tokenHash: (await import("../../src/modules/auth/infrastructure/session-token")).hashSessionToken(session.token) } })).id);
    await db.aiSetting.update({ where: { id: before.id }, data: { scraperEnabled: before.scraperEnabled, browserEnabled: before.browserEnabled, cianAutoBrowser: before.cianAutoBrowser, yandexAutoBrowser: before.yandexAutoBrowser, enabledSources: before.enabledSources, aiEnabled: before.aiEnabled } });
    await writeFile("docs/vkr/live-search-v323-browser-queue.json", JSON.stringify({ mode: "LIVE", at: new Date().toISOString(), database: "crm_demo", port: 3383, query: "аренда офиса Новосибирск", browser: "ordinary Chromium; Cian headed, Yandex headless; no stealth", depth: { maxPages: 1, limit: 5 }, settingsUi, processCleanup: true, results }, null, 2) + "\n");
    await disconnectDb();
  }
}
void main().catch(async () => { console.error("LIVE_QUEUE_FAILED: inspect local aggregate/process logs"); await disconnectDb(); process.exitCode = 1; });
