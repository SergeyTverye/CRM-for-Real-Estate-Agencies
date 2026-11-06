import { z } from "zod";

/**
 * Runtime-валидация переменных окружения (ТЗ 36.5).
 * Значения, влияющие на безопасность, проверяются при старте и не имеют
 * небезопасных production-defaults.
 */

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .optional()
    .transform((v) => (v === undefined ? def : ["true", "1", "yes"].includes(v)));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEAK_DB_PASSWORDS = new Set(["", "password", "postgres", "changeme", "change_me", "crm", "admin", "123456", "secret"]);

/** Пустой, демонстрационный или короткий (< 12 символов) пароль PostgreSQL в production запрещён. */
function isWeakDbPassword(url: string): boolean {
  try {
    const pwd = decodeURIComponent(new URL(url).password);
    return WEAK_DB_PASSWORDS.has(pwd.toLowerCase()) || pwd.length < 12 || /change[_-]?me/i.test(pwd);
  } catch {
    return true;
  }
}

const DEV_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    CRM_DEPLOYMENT_MODE: z.enum(["server", "desktop"]).default("server"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL обязателен"),
    APP_PORT: int(3000, 1, 65535),
    APP_VERSION: z.string().default("dev"),
    APP_COMMIT: z.string().default("unknown"),
    APP_TIMEZONE: z.string().default("Asia/Novosibirsk"),

    DEPLOYMENT_MODE: z.enum(["server", "portable"]).default("server"),
    DEPLOYMENT_ID: z.string().uuid().optional(),
    INSTANCE_ID: z.string().min(1).optional(),
    INSTANCE_ROLE: z.enum(["active", "standby"]).default("active"),

    SESSION_TTL_HOURS: int(12, 1, 24 * 30),
    COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
    LOGIN_MAX_FAILURES: int(5, 1, 100),
    LOGIN_LOCK_MINUTES: int(15, 1, 24 * 60),

    FILE_STORAGE_PATH: z.string().default("./data/files"),
    IMPORT_STAGING_PATH: z.string().default("./data/import-staging"),
    BACKUP_PATH: z.string().default("./backups"),
    MAX_UPLOAD_MB: int(50, 1, 2048),
    UPLOAD_ALLOWED_EXTENSIONS: z.string().default("pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx,txt,csv"),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    REACTIVATION_GAP_DAYS: int(90, 1, 3650),
    NEED_INACTIVITY_DAYS: int(14, 1, 365),
    AGREEMENT_EXPIRY_WARNING_DAYS: int(30, 1, 365),
    AD_CHECK_INTERVAL_DAYS: int(7, 1, 365),

    BACKUP_TARGETS: z.string().default(""),
    AI_ENABLED: bool(false),
    YANDEX_CLOUD_API_KEY: z.string().default(""),
    YANDEX_CLOUD_FOLDER: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("b1gsj611qbf7re0rfcde"),
    YANDEX_CLOUD_MODEL: z.string().min(1).default("aliceai-llm-flash/latest"),
    YANDEX_CLOUD_WEB_MODEL: z.string().default(""),
    YANDEX_CLOUD_BASE_URL: z.literal("https://ai.api.cloud.yandex.net/v1").default("https://ai.api.cloud.yandex.net/v1"),
    YANDEX_AI_STORE_RESPONSES: z.enum(["false", "0", "no"]).optional().transform(() => false as const),
    YANDEX_AI_MAX_OUTPUT_TOKENS: int(1800, 1, 32768),
    YANDEX_AI_TIMEOUT_MS: int(30000, 100, 120000),
    YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR: int(30, 0, 10000),
    YANDEX_AI_MAX_MONTHLY_COST_RUB: z.string().regex(/^\d+(?:\.\d{1,6})?$/).default("1000"),
    YANDEX_WEB_SEARCH_ENABLED: bool(false),
    YANDEX_WEB_SEARCH_AUTO_FALLBACK: bool(false),
    YANDEX_WEB_SEARCH_CONTEXT_SIZE: z.enum(["low", "medium", "high"]).default("low"),
    YANDEX_WEB_SEARCH_REGION: z.string().regex(/^\d+$/).default("65"),
    YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB: int(1, 0, 100),
    YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY: int(3, 0, 1000),
    YANDEX_WEB_SEARCH_ALLOWED_DOMAINS: z.string().default("").refine((v) => {
      const domains = v.split(",").map((s) => s.trim()).filter(Boolean);
      return domains.length <= 5 && domains.every((s) => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s));
    }, "Допустимо до 5 доменов без схемы и пути"),
    SCRAPER_ENABLED: bool(false),
    SCRAPER_DEMO_FIXTURES: bool(false),
    SCRAPER_BROWSER_ENABLED: bool(true),
    SCRAPER_CHROME_PATH: z.string().min(1).optional(),
    SCRAPER_JOB_TIMEOUT_MS: int(180000, 1000, 600000),
    SCRAPER_MAX_CONCURRENT_JOBS: int(1, 1, 10),
    SCRAPER_RESULT_TTL_HOURS: int(24, 1, 720),
  })
  .superRefine((env, ctx) => {
    if (env.APP_TIMEZONE && !isValidTimeZone(env.APP_TIMEZONE)) {
      ctx.addIssue({ code: "custom", path: ["APP_TIMEZONE"], message: "Неизвестный часовой пояс IANA" });
    }
    if (env.NODE_ENV === "production") {
      if (!env.DEPLOYMENT_ID) ctx.addIssue({ code: "custom", path: ["DEPLOYMENT_ID"], message: "обязателен в production" });
      if (!env.INSTANCE_ID) ctx.addIssue({ code: "custom", path: ["INSTANCE_ID"], message: "обязателен в production" });
      if (!env.APP_TIMEZONE) ctx.addIssue({ code: "custom", path: ["APP_TIMEZONE"], message: "обязателен в production" });
      if (env.CRM_DEPLOYMENT_MODE === "server" && isWeakDbPassword(env.DATABASE_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "в production запрещён демонстрационный пароль БД — запустите scripts/bootstrap.sh",
        });
      }
    }
  });

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(raw: z.infer<typeof schema>) {
  return {
    ...raw,
    // Рабочий часовой пояс по умолчанию — Новосибирск (ТЗ v2.4.1 §5).
    // В production идентификаторы обязательны (см. superRefine).
    APP_TIMEZONE: raw.APP_TIMEZONE,
    DEPLOYMENT_ID: raw.DEPLOYMENT_ID ?? DEV_DEPLOYMENT_ID,
    INSTANCE_ID: raw.INSTANCE_ID ?? "dev-instance",
    uploadAllowedExtensions: raw.UPLOAD_ALLOWED_EXTENSIONS.split(",")
      .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
    maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
    backupTargets: raw.BACKUP_TARGETS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    isProduction: raw.NODE_ENV === "production",
    isReadOnlyInstance: raw.INSTANCE_ROLE === "standby",
  };
}

let cached: AppConfig | null = null;

export class ConfigError extends Error {}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Некорректная конфигурация окружения: ${details}`);
  }
  return buildConfig(parsed.data);
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Только для тестов: сбросить кэш после изменения process.env. */
export function resetConfigCache(): void {
  cached = null;
}
