import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSqliteMigrationSql, normalizeSqlToLf, resolveBaselineWrite, writeBaselineSql } from "../../scripts/desktop/gen-sqlite-migration";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("SQLite migration LF determinism (history checksums stay strict)", () => {
  it("normalizes CRLF and lone CR to LF without touching content", () => {
    expect(normalizeSqlToLf("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeSqlToLf("CREATE TABLE \"t\" (\r\n    \"id\" TEXT\r\n);\r\n")).toBe("CREATE TABLE \"t\" (\n    \"id\" TEXT\n);\n");
    expect(normalizeSqlToLf("already\nlf\n")).toBe("already\nlf\n");
    expect(normalizeSqlToLf("")).toBe("");
  });

  it("is idempotent and leaves no CR behind", () => {
    const once = normalizeSqlToLf("x\r\ny\rz\n");
    expect(once).not.toContain("\r");
    expect(normalizeSqlToLf(once)).toBe(once);
  });

  it("emits LF-only bytes from CRLF inputs through the real generator boundary", () => {
    const diffSql = "CREATE TABLE \"synthetic_widget\" (\r\n    \"id\" TEXT NOT NULL PRIMARY KEY,\r\n    \"created_at\" INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP\r\n);\r\n";
    const pgSql = "ALTER TABLE \"synthetic_widget\" ADD CONSTRAINT \"synthetic_widget_positive_check\" CHECK (\"value\" > 0);\r\n";
    const constraintsSql = "CREATE TRIGGER synthetic_widget_guard BEFORE INSERT ON synthetic_widget\r\nBEGIN SELECT RAISE(ABORT,'guard'); END;\r\n";
    const { sql } = buildSqliteMigrationSql(diffSql, [pgSql], constraintsSql);
    expect(sql).not.toContain("\r");
    expect(sql).toContain("CONSTRAINT \"synthetic_widget_positive_check\" CHECK (\"value\" > 0)");
    expect(sql).toContain("synthetic_widget_guard");
    expect(sql).toContain("DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))");
  });

  it("produces byte-identical output for CRLF vs LF inputs (coordinator equality condition)", () => {
    const lfDiff = "CREATE TABLE \"synthetic_widget\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY\n);\n";
    const lfPg = "ALTER TABLE \"synthetic_widget\" ADD CONSTRAINT \"c\" CHECK (\"v\" > 0);\n";
    const lfConstraints = "CREATE INDEX synthetic_idx ON synthetic_widget(id);\n";
    const fromCrlf = buildSqliteMigrationSql(
      lfDiff.replaceAll("\n", "\r\n"),
      [lfPg.replaceAll("\n", "\r\n")],
      lfConstraints.replaceAll("\n", "\r\n"),
    ).sql;
    const fromLf = buildSqliteMigrationSql(lfDiff, [lfPg], lfConstraints).sql;
    expect(fromCrlf).toBe(fromLf);
    expect(fromCrlf).not.toContain("\r");
    expect(sha256(fromCrlf)).toBe(sha256(fromLf));
    // Strict raw checksums correctly catch the pre-fix difference.
    expect(sha256(lfDiff.replaceAll("\n", "\r\n"))).not.toBe(sha256(lfDiff));
  });
});

describe("SQLite baseline immutable writer guard (fail closed before writes)", () => {
  const appliedBaseline = 'CREATE TABLE "synthetic_widget" (\n    "id" TEXT NOT NULL PRIMARY KEY\n);\n';
  const driftedBaseline =
    appliedBaseline + 'CREATE TABLE "backup_queue_journals" (\n    "id" TEXT NOT NULL PRIMARY KEY\n);\n';

  it("initializes an absent baseline with the generated SQL", () => {
    expect(resolveBaselineWrite(null, appliedBaseline)).toEqual({ action: "create", sqlToWrite: appliedBaseline });
    expect(resolveBaselineWrite(undefined, appliedBaseline).action).toBe("create");
    const dir = mkdtempSync(join(tmpdir(), "baseline-absent-"));
    const target = join(dir, "migration.sql");
    expect(writeBaselineSql(target, appliedBaseline)).toBe("create");
    expect(readFileSync(target, "utf8")).toBe(appliedBaseline);
  });

  it("treats byte-identical baselines as a noop", () => {
    expect(resolveBaselineWrite(appliedBaseline, appliedBaseline)).toEqual({ action: "identical", sqlToWrite: null });
    const dir = mkdtempSync(join(tmpdir(), "baseline-identical-"));
    const target = join(dir, "migration.sql");
    writeFileSync(target, appliedBaseline);
    expect(writeBaselineSql(target, appliedBaseline)).toBe("identical");
    expect(readFileSync(target, "utf8")).toBe(appliedBaseline);
  });

  it("allows only canonical LF rewrite when semantics match across line endings", () => {
    const crlfExisting = appliedBaseline.replaceAll("\n", "\r\n");
    const decision = resolveBaselineWrite(crlfExisting, appliedBaseline);
    expect(decision.action).toBe("normalize-line-endings");
    expect(decision.sqlToWrite).toBe(appliedBaseline);
    const dir = mkdtempSync(join(tmpdir(), "baseline-crlf-"));
    const target = join(dir, "migration.sql");
    writeFileSync(target, crlfExisting);
    expect(writeBaselineSql(target, appliedBaseline)).toBe("normalize-line-endings");
    expect(readFileSync(target, "utf8")).toBe(appliedBaseline);
  });

  it("refuses a semantically different existing baseline and leaves bytes untouched", () => {
    expect(() => resolveBaselineWrite(appliedBaseline, driftedBaseline)).toThrow(/Refusing to overwrite applied SQLite baseline/);
    const dir = mkdtempSync(join(tmpdir(), "baseline-drift-"));
    const target = join(dir, "migration.sql");
    writeFileSync(target, appliedBaseline);
    const before = readFileSync(target, "utf8");
    expect(() => writeBaselineSql(target, driftedBaseline)).toThrow(/Refusing to overwrite applied SQLite baseline/);
    expect(readFileSync(target, "utf8")).toBe(before);
  });
});
