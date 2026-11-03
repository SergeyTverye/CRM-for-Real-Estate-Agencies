import { describe, expect, it } from "vitest";
import { loadConfig } from "@/shared/config/env";

const base = { DATABASE_URL: "postgresql://crm:Strong9Secret@db:5432/crm" };

describe("валидация окружения", () => {
  it("development запускается с безопасными dev-значениями по умолчанию", () => {
    const cfg = loadConfig({ ...base, NODE_ENV: "development" });
    expect(cfg.INSTANCE_ROLE).toBe("active");
    expect(cfg.maxUploadBytes).toBe(50 * 1024 * 1024);
  });

  it("production требует DEPLOYMENT_ID, INSTANCE_ID и APP_TIMEZONE", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/DEPLOYMENT_ID/);
  });

  it("production отклоняет демонстрационный пароль БД", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://crm:change_me@db:5432/crm",
        DEPLOYMENT_ID: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
        INSTANCE_ID: "srv-1",
        APP_TIMEZONE: "Europe/Moscow",
      }),
    ).toThrow(/демонстрационный пароль/);
  });

  it("отклоняет неизвестный часовой пояс и некорректную роль экземпляра", () => {
    expect(() => loadConfig({ ...base, APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/);
    expect(() => loadConfig({ ...base, INSTANCE_ROLE: "writer" })).toThrow(/INSTANCE_ROLE/);
  });

  it("standby-экземпляр помечается как только чтение", () => {
    expect(loadConfig({ ...base, INSTANCE_ROLE: "standby" }).isReadOnlyInstance).toBe(true);
  });
});
