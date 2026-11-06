import { afterEach, describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";

const guard = path.resolve("scripts/security/confidential-guard.mjs");
const producer = path.resolve("scripts/security/make-fingerprints.mjs");
const fixture = path.resolve("tests/fixtures/synthetic/confidential-like.xlsx");
const roots: string[] = [];
const secret = "Синтетический объект Альфа 92387";
function repo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "crm-confidential-guard-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root], { stdio: "pipe" });
  return root;
}
function put(root: string, name: string, value: string | Buffer | Uint8Array) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), value);
}
function stage(root: string, name: string) {
  execFileSync("git", ["-C", root, "add", "--force", "--", name], { stdio: "pipe" });
}
function fingerprints(root: string, values = [secret]) {
  put(root, "private-data/fingerprints.json", JSON.stringify(values.map((v) =>
    createHash("sha256").update(v.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim()).digest("hex"))));
}
function run(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [guard, "--root", root, ...args], { encoding: "utf8", timeout: 30_000 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain(secret);
  return { status: result.status, output: result.stdout };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(os.tmpdir(), "crm-confidential-guard-"))) throw new Error("TEMP_SCOPE");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("confidential guard (synthetic only)", () => {
  it.each([
    "РЕКЛАМНЫЕ ОБЪЕКТЫ_РАБОТА.xlsx", "copy/РЕКЛАМНЫЕ ОБЪЕКТЫ_РАБОТА.xlsx",
    "~$anything.xlsx", "private-data/local.txt", "data/private-imports/local.csv",
    "export.crmbackup", "snapshot.dump", "nested/db.sqlite", "snapshot.db",
    "nested/crm-secrets/key.txt", "nested/clouds.env", "db.sqlite-wal",
  ])("rejects prohibited name without reading content: %s", (name) => {
    const root = repo();
    put(root, name, "SYNTHETIC");
    stage(root, name);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain("CG_PATH");
  });
  it("permits synthetic database fixtures and names-only mode", () => {
    const root = repo();
    put(root, "tests/fixtures/synthetic/demo.db", secret);
    stage(root, "tests/fixtures/synthetic/demo.db");
    expect(run(root)).toMatchObject({ status: 0 });
    expect(run(root).output).toContain("CG_NAMES_ONLY");
  });
  it("uses staged blobs even after working tree is cleaned", () => {
    const root = repo();
    fingerprints(root);
    put(root, "example.txt", 'prefix "' + secret.toUpperCase().replaceAll(" ", "  ") + '" suffix');
    stage(root, "example.txt");
    put(root, "example.txt", "safe");
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('CG_FINGERPRINT "example.txt"');
    expect(result.output).not.toContain(secret.toUpperCase());
  });
  it("does not scan unstaged content", () => {
    const root = repo();
    fingerprints(root);
    put(root, "example.txt", "safe");
    stage(root, "example.txt");
    put(root, "example.txt", secret);
    expect(run(root).status).toBe(0);
  });
  it("rejects broken fingerprint configuration", () => {
    const root = repo();
    put(root, "private-data/fingerprints.json", "not-json");
    expect(run(root).output).toContain("CG_FINGERPRINTS_INVALID");
    expect(run(root).status).toBe(1);
  });
  it("detects xlsx sharedStrings, rich-text runs and numeric cells", async () => {
    const root = repo();
    fingerprints(root, [secret]);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Synthetic");
    sheet.getCell("A1").value = { richText: [{ text: "Синтетический объект " }, { text: "Альфа 92387" }] };
    sheet.getCell("B1").value = 54321987;
    put(root, "sample.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    stage(root, "sample.xlsx");
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('CG_FINGERPRINT "sample.xlsx"');
    fingerprints(root, ["54321987"]);
    expect(run(root).status).toBe(1);
  }, 20_000);
  it("detects nested zip, XML entities and does not disclose member names", () => {
    const root = repo();
    fingerprints(root, ["Синтетика & тест"]);
    const inner = zipSync({ "xl/sharedStrings.xml": strToU8("<sst><si><t>Синтетика &amp; тест</t></si></sst>") });
    put(root, "bundle.zip", zipSync({ [secret + ".zip"]: inner }));
    stage(root, "bundle.zip");
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('CG_FINGERPRINT "bundle.zip"');
  });
  it("rejects invalid archives and traversal", () => {
    const root = repo();
    fingerprints(root);
    put(root, "broken.xlsx", "invalid");
    stage(root, "broken.xlsx");
    put(root, "escape.zip", zipSync({ "../file.txt": strToU8("safe") }));
    stage(root, "escape.zip");
    expect(run(root).output).toContain("CG_ARCHIVE_INVALID");
    expect(run(root).status).toBe(1);
  });
  it("scans artifact directories including ignored files", () => {
    const root = repo();
    fingerprints(root);
    put(root, "test-results/report.txt", secret);
    expect(run(root).status).toBe(0);
    expect(run(root, "--artifacts").status).toBe(1);
    put(root, "dist/private-data/file.txt", "SYNTHETIC");
    expect(run(root, "--artifacts").output).toContain("CG_PATH");
  });
  it("checks explicit artifacts and fails if absent", () => {
    const root = repo();
    fingerprints(root);
    put(root, "release/renamed.bin", zipSync({ "strings.txt": strToU8(secret) }));
    expect(run(root, "--artifact", "release").status).toBe(1);
    expect(run(root, "--artifact", "missing").status).toBe(1);
    expect(run(root, "--artifact", "../outside").output).toContain("CG_SCOPE");
  });
  it("trusted generator emits hashes only from the synthetic fixture", () => {
    const root = repo();
    put(root, "tests/fixtures/synthetic/confidential-like.xlsx", readFileSync(fixture));
    const env = { ...process.env };
    delete env.CI;
    const result = spawnSync(process.execPath, [producer, "tests/fixtures/synthetic/confidential-like.xlsx"], { cwd: root, env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^\d+\s*$/u);
    const output = readFileSync(path.join(root, "private-data/fingerprints.json"), "utf8");
    expect(output).not.toContain(secret);
    const hashes = JSON.parse(output) as string[];
    expect(hashes.length).toBeGreaterThan(0);
    expect(hashes.every((v) => /^[a-f0-9]{64}$/u.test(v))).toBe(true);
    put(root, "leak.txt", secret);
    stage(root, "leak.txt");
    expect(run(root).status).toBe(1);
  });
  it("normalizes telephone formatting and UTF-16 artifacts", () => {
    const root = repo();
    fingerprints(root, ["79990001234"]);
    put(root, "docs/report.txt", Buffer.from("phone: +7 (999) 000-12-34", "utf16le"));
    expect(run(root, "--artifacts").status).toBe(1);
  });
  it("rejects artifact parent junctions without reading their target", () => {
    const root = repo();
    put(root, "synthetic-target/report.txt", secret);
    symlinkSync(path.join(root, "synthetic-target"), path.join(root, "report-link"), process.platform === "win32" ? "junction" : "dir");
    expect(run(root, "--artifact", "report-link/report.txt").status).toBe(1);
  });
  it("rejects excessive archive nesting and forbidden member paths", () => {
    const root = repo();
    fingerprints(root);
    let archive = zipSync({ "safe.txt": strToU8("safe") });
    for (let i = 0; i < 5; i++) archive = zipSync({ "nested.zip": archive });
    put(root, "deep.zip", archive);
    stage(root, "deep.zip");
    put(root, "prohibited.zip", zipSync({ "private-data/value.txt": strToU8(secret) }));
    stage(root, "prohibited.zip");
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain("CG_LIMIT");
    expect(result.output).toContain('CG_PATH "prohibited.zip"');
  });
  it("rejects XML DTD without leaking library diagnostics", () => {
    const root = repo();
    fingerprints(root);
    put(root, "entity.zip", zipSync({ "test.xml": strToU8('<!DOCTYPE x [<!ENTITY value "SYNTHETIC">]><x>&value;</x>') }));
    stage(root, "entity.zip");
    expect(run(root).output).toContain("CG_XML_INVALID");
  });
  it("trusted producer refuses CI execution", () => {
    const root = repo();
    const result = spawnSync(process.execPath, [producer, fixture], { cwd: root, env: { ...process.env, CI: "true" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toBe("");
  });
});
