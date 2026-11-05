import { config } from "dotenv";
import { spawn } from "node:child_process";

config({ path: [".env.local", ".env"], quiet: true });
// Отдельный процесс только для синтетической БД. Файлы берутся из настроенного StorageAdapter.
const ai = process.env.VKR_AI_DEMO === "true";
const port = process.env.VKR_PORT ?? (ai ? "3211" : "3210");
const databaseURL = process.env.VKR_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
if (new URL(databaseURL).pathname !== "/crm_demo") throw new Error("VKR server requires crm_demo");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseURL,
    SCRAPER_DEMO_FIXTURES: "true", SCRAPER_ENABLED: "true", APP_TIMEZONE: "Asia/Novosibirsk", COOKIE_SECURE: "false", LOG_LEVEL: "warn",
    // Repeated screenshot rehearsals use only FakeResponsesProvider; keep the real ledger intact.
    YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY: ai ? "30" : (process.env.YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY ?? "3"),
    AI_ENABLED: String(ai), YANDEX_WEB_SEARCH_ENABLED: String(ai), YANDEX_WEB_SEARCH_AUTO_FALLBACK: String(ai),
    // Секрет провайдера в демо-процесс не передаётся.
    YANDEX_CLOUD_API_KEY: "", INSTANCE_ID: `vkr-screenshots-${port}` },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
