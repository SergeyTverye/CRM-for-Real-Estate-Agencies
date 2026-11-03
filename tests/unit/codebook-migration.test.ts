import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CODEBOOK_COLUMNS, checkConstraintSql } from "@/shared/codebook";

const migrationsDir = path.resolve(__dirname, "../../prisma/migrations");
const allSql = readdirSync(migrationsDir)
  .filter((d) => !d.endsWith(".toml"))
  .map((d) => readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
  .join("\n");

describe("системный codebook и миграции", () => {
  it.each(CODEBOOK_COLUMNS.map((c) => [`${c.table}.${c.column}`, c] as const))("CHECK для %s совпадает с codebook", (_name, entry) => {
    expect(allSql).toContain(checkConstraintSql(entry));
  });

  it("нет ON DELETE CASCADE (значимая история не удаляется каскадно)", () => {
    expect(allSql).not.toMatch(/ON DELETE CASCADE/i);
  });

  it("partial unique для активного grant и контактов клиента", () => {
    expect(allSql).toMatch(/property_contact_grants_active_key[\s\S]*WHERE "revoked_at" IS NULL/);
    expect(allSql).toMatch(/client_contacts_client_type_normalized_key[\s\S]*WHERE "normalized_value" IS NOT NULL/);
  });

  it("деньги — numeric(16,2), не float", () => {
    expect(allSql).toMatch(/"deal_price" DECIMAL\(16,2\)/);
    expect(allSql).toMatch(/"amount" DECIMAL\(16,2\) NOT NULL/);
    expect(allSql).not.toMatch(/DOUBLE PRECISION|REAL\b/);
  });

  it("исторический архив не содержит паспортных/регистрационных полей", () => {
    const archive = /CREATE TABLE "historical_deal_archive" \(([\s\S]*?)\);/.exec(allSql)?.[1] ?? "";
    expect(archive).not.toMatch(/passport|issued|registration|birth/i);
  });
});
