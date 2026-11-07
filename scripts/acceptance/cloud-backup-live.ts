/** Opt-in manual runner. Never invoke without --execute-cloud-live. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

type Secrets = Record<string, string>;
export const LIVE_FLAG = "--execute-cloud-live";
export const UI_SCOPE = "--scope=ui-config-probe";
export const MODULE_SCOPE = "--scope=module-transfer-restore";
const ENV_FILE = "D:\\crm-secrets\\clouds.env";
const stages = new Set(["UI_CONFIG_PROBE", "RUN_PREFIX", "MODULE_TRANSFER_RESTORE", "LIVE_SMOKE"]);
const statuses = new Set(["COMPLETED", "ALLOCATED", "OPT_IN_FLAG_REQUIRED", "LIVE_SCOPE_REQUIRED", "SYNTHETIC_MANAGER_CONFIGURATION_MISSING", "CRM_LIVE_HOST_NOT_LOOPBACK", "CLOUD_CONFIGURATION_MISSING", "LIVE_SMOKE_FAILED"]);
const safeEnum = (value: string) => /^[A-Z][A-Z0-9_]{0,40}$/.test(value);

export function readSecretAlias(secrets: Secrets, names: string[]): string {
  for (const name of names) if (secrets[name]?.trim()) return secrets[name]!.trim();
  throw new Error("CLOUD_CONFIGURATION_MISSING");
}

export function validateDisposableBaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("CRM_LIVE_HOST_NOT_LOOPBACK"); }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!new Set(["http:", "https:"]).has(url.protocol) || !loopback.has(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) {
    throw new Error("CRM_LIVE_HOST_NOT_LOOPBACK");
  }
  return url;
}

export function safeResult(stage: string, status: string, numeric: Record<string, number> = {}) {
  if (!safeEnum(stage) || !stages.has(stage) || !safeEnum(status) || !statuses.has(status) || Object.values(numeric).some(n => !Number.isFinite(n) || n < 0)) {
    throw new Error("UNSAFE_RESULT_REJECTED");
  }
  return { stage, status, ...numeric };
}

async function main() {
  if (!process.argv.includes(LIVE_FLAG)) throw new Error("OPT_IN_FLAG_REQUIRED");
  const isUi = process.argv.includes(UI_SCOPE);
  const isModule = process.argv.includes(MODULE_SCOPE);
  if (isUi === isModule) throw new Error("LIVE_SCOPE_REQUIRED");
  if (isUi) {
    const baseUrl = process.env.CRM_CLOUD_LIVE_BASE_URL;
    const login = process.env.CRM_CLOUD_LIVE_MANAGER_LOGIN;
    const password = process.env.CRM_CLOUD_LIVE_MANAGER_PASSWORD;
    if (!baseUrl || !login || !password) throw new Error("SYNTHETIC_MANAGER_CONFIGURATION_MISSING");
    validateDisposableBaseUrl(baseUrl);
  }

  // This is the only code path permitted to read the external credentials file.
  const secrets = parse(await readFile(ENV_FILE, "utf8"));
  const yandex = {
    bucket: readSecretAlias(secrets, ["YANDEX_S3_BUCKET", "YC_S3_BUCKET"]),
    accessKeyId: readSecretAlias(secrets, ["YANDEX_S3_ACCESS_KEY_ID", "YC_S3_ACCESS_KEY_ID"]),
    secretAccessKey: readSecretAlias(secrets, ["YANDEX_S3_SECRET_ACCESS_KEY", "YC_S3_SECRET_ACCESS_KEY"]),
  };
  const mailru = {
    email: readSecretAlias(secrets, ["MAILRU_WEBDAV_EMAIL", "MAILRU_EMAIL"]),
    applicationPassword: readSecretAlias(secrets, ["MAILRU_WEBDAV_APP_PASSWORD", "MAILRU_APP_PASSWORD"]),
  };
  if (isModule) {
    const { runModuleTransferRestore, moduleFailureDiagnostic } = await import("./cloud-module");
    try {
      const evidence = await runModuleTransferRestore({ yandex, mailru });
      console.log(JSON.stringify([safeResult("MODULE_TRANSFER_RESTORE", "COMPLETED", {
        providers: evidence.providers, bytes: evidence.bytes, restoredInstances: evidence.restoredInstances,
        s3Parts: evidence.s3Parts, mailruChunks: evidence.mailruChunks,
        failureModes: evidence.failureModes, anonymousDenied: evidence.anonymousDenied,
        hashesMatch: evidence.hashesMatch ? 1 : 0,
      })]));
    } catch (error) {
      const diagnostic = moduleFailureDiagnostic(error);
      if (!diagnostic) throw error;
      console.error(JSON.stringify([diagnostic]));
      process.exitCode = 1;
    }
    return;
  }
  const baseUrl = validateDisposableBaseUrl(process.env.CRM_CLOUD_LIVE_BASE_URL!).toString();
  const login = process.env.CRM_CLOUD_LIVE_MANAGER_LOGIN!;
  const password = process.env.CRM_CLOUD_LIVE_MANAGER_PASSWORD!;
  const runId = randomUUID();
  const prefix = `crm-synthetic-smoke/${runId}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, recordVideo: undefined });
    const page = await context.newPage();
    page.on("console", () => {}); // Deliberately discard all console output.
    page.on("pageerror", () => {});
    await page.goto(new URL("/login", baseUrl).toString());
    await page.getByLabel("Логин").fill(login);
    await page.getByLabel("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти" }).click();
    await page.waitForURL(/\/today/, { timeout: 60_000 });
    await page.goto(new URL("/settings/backups", baseUrl).toString());
    await page.getByRole("heading", { name: "Локальная установка и резервные копии" }).waitFor();

    // Credentials are entered directly into password fields and are never logged or persisted by this runner.
    for (const provider of [
      { label: "Яндекс Облако", secret: yandex.secretAccessKey, id: yandex.accessKeyId, bucket: yandex.bucket },
      { label: "Облако Mail.ru", secret: mailru.applicationPassword, email: mailru.email },
    ]) {
      await page.getByRole("region", { name: provider.label, exact: true }).getByRole("button", { name: `Настроить ${provider.label}` }).click();
      if (provider.bucket) await page.getByLabel("Bucket").fill(provider.bucket);
      if (provider.email) await page.getByLabel("Email").fill(provider.email);
      await page.getByLabel("Префикс установки").fill(prefix);
      if (provider.id) await page.getByLabel("Access key ID (новый)").fill(provider.id);
      await page.getByLabel(provider.id ? "Secret access key" : "Пароль внешнего приложения").fill(provider.secret);
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Сохранить направление" }).click();
      await page.getByText("Настройки сохранены. Пароли удалены из полей формы.").waitFor({ timeout: 30_000 });
      await page.getByRole("region", { name: provider.label, exact: true }).getByRole("button", { name: "Проверить подключение" }).click();
      await page.getByRole("status").filter({ hasText: "Чтение доступно" }).waitFor({ timeout: 60_000 });
    }

    // Deliberately stop at verifiable UI setup/probes. Backup and restore require an isolated backend/runtime contract (see cloud-test-plan.md); never point production at fixture data.
    console.log(JSON.stringify([
      safeResult("UI_CONFIG_PROBE", "COMPLETED", { providers: 2, successfulProbes: 2 }),
      safeResult("RUN_PREFIX", "ALLOCATED", { characters: prefix.length }),
    ]));
    await context.close();
  } finally {
    await browser.close();
    // Do not print or persist secrets, provider responses, browser artifacts or the remote prefix.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error && statuses.has(error.message) ? error.message : "LIVE_SMOKE_FAILED";
    console.error(JSON.stringify([safeResult("LIVE_SMOKE", message)]));
    process.exitCode = 1;
  });
}
