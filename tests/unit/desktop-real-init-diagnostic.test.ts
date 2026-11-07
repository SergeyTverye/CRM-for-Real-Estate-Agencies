import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const location = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("../../src/shared/db/sqlite-adapter", () => ({ sqliteFilePath: location.check }));
import { desktopInitFailureCode, initializeDesktopDatabase } from "../../scripts/desktop/init-db";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  location.check.mockReset();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })));
});

it.each(["ETIMEDOUT", "ENOENT", "ERR_DLOPEN_FAILED", "PRIVATE_NOT_ALLOWED"])("reports only finite codes for a real location-stage rejection: %s", async code => {
  vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop");
  const root = await mkdtemp(path.join(tmpdir(), "crm-init-diagnostic-"));
  roots.push(root);
  const error = Object.assign(new Error("synthetic-secret-path-and-stderr"), { code, stderr: "synthetic-secret", stdout: "synthetic-secret" });
  location.check.mockImplementation(() => { throw error; });
  await expect(initializeDesktopDatabase({ directory: root })).rejects.toBe(error);
  expect(desktopInitFailureCode(error)).toBe(`INIT_DATABASE_FAILED_STAGE_LOCATION_CODE_${code === "PRIVATE_NOT_ALLOWED" ? "OTHER" : code}`);
});

it("does not trust diagnostic-shaped messages or unknown errors", () => {
  expect(desktopInitFailureCode(new Error("INIT_DATABASE_FAILED_STAGE_LOCATION_CODE_ETIMEDOUT"))).toBe("INIT_DATABASE_FAILED");
  expect(desktopInitFailureCode("synthetic-secret")).toBe("INIT_DATABASE_FAILED");
});
