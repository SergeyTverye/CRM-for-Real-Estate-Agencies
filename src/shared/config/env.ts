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

const DEV_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL обязателен"),
    APP_PORT: int(3000, 1, 65535),
    APP_VERSION: z.string().default("dev"),
    APP_COMMIT: z.string().default("unknown"),
    APP_TIMEZONE: z.string().optional(),

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
  })
  .superRefine((env, ctx) => {
    if (env.APP_TIMEZONE && !isValidTimeZone(env.APP_TIMEZONE)) {
      ctx.addIssue({ code: "custom", path: ["APP_TIMEZONE"], message: "Неизвестный часовой пояс IANA" });
    }
    if (env.NODE_ENV === "production") {
      if (!env.DEPLOYMENT_ID) ctx.addIssue({ code: "custom", path: ["DEPLOYMENT_ID"], message: "обязателен в production" });
      if (!env.INSTANCE_ID) ctx.addIssue({ code: "custom", path: ["INSTANCE_ID"], message: "обязателен в production" });
      if (!env.APP_TIMEZONE) ctx.addIssue({ code: "custom", path: ["APP_TIMEZONE"], message: "обязателен в production" });
      if (/change[_-]?me|password@|:postgres@/i.test(env.DATABASE_URL)) {
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
    // В dev/test допустим фиксированный часовой пояс и идентификаторы;
    // в production они обязательны (см. superRefine).
    APP_TIMEZONE: raw.APP_TIMEZONE ?? "Europe/Moscow",
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
