import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "../../src/modules/auth/infrastructure/session-token";
import { defaultSettings } from "../../src/modules/desktop-backup/domain/settings";
const userId = randomUUID();
vi.mock("@/modules/auth/application/session-service", () => ({
  resolveSession: async (token: string | undefined) => token === "manager" || token === "realtor" ? { userId, role: token, login: "synthetic", displayName: "Synthetic", mustChangePassword: false, sessionId: randomUUID() } : null,
}));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function req(method: string, role?: string, body?: unknown, origin = "http://127.0.0.1:3503") {
  return new NextRequest("http://127.0.0.1:3503/api/v1/settings/backups", { method, headers: { host: "127.0.0.1:3503", origin, "content-type": "application/json", ...(role ? { cookie: SESSION_COOKIE + "=" + role } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
for (const mode of ["server", "desktop"]) it("HTTP role/CSRF/OCC and write-only credentials in " + mode + " mode (synthetic session adapter)", async () => {
  vi.resetModules(); const root = await mkdtemp(path.join(os.tmpdir(), "crm-settings-api-")); roots.push(root);
  vi.stubEnv("CRM_DEPLOYMENT_MODE", mode); vi.stubEnv("BACKUP_SETTINGS_DIR", root);
  vi.stubEnv("BACKUP_SETTINGS_MASTER_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1:1/crm_test_unused"); vi.stubEnv("LOG_LEVEL", "silent"); vi.stubEnv("NODE_ENV", "test");
  const { GET, PUT } = await import("../../src/app/api/v1/settings/backups/route");
  const ctx = { params: Promise.resolve({}) };
  expect((await GET(req("GET"), ctx)).status).toBe(401);
  expect((await GET(req("GET", "realtor"), ctx)).status).toBe(403);
  expect((await PUT(req("PUT", "realtor", {}), ctx)).status).toBe(403);
  const before = await GET(req("GET", "manager"), ctx); expect(before.status).toBe(200);
  expect((await before.json()).secretStorage.protection).toBe(mode === "server" ? "server-aes-256-gcm" : "windows-dpapi-current-user");
  const initial = defaultSettings(); const body = { expectedUpdatedAt: null, schedule: initial.schedule, retention: initial.retention, destinations: [{ id: randomUUID(), kind: "mailru_webdav", enabled: true, email: "synthetic@example.invalid", prefix: "synthetic", endpoint: "https://webdav.cloud.mail.ru", partBytes: 1024 ** 2, useMove: true, applicationPassword: "synthetic-password-never-returned" }] };
  expect((await PUT(req("PUT", "manager", body, "https://evil.invalid"), ctx)).status).toBe(403);
  if (mode === "desktop" && process.platform !== "win32") return;
  const update = await PUT(req("PUT", "manager", body), ctx); expect(update.status).toBe(200);
  const result = await update.text(); expect(result).not.toContain("synthetic-password-never-returned"); expect(result).toContain('"credentialsConfigured":true');
  const read = await GET(req("GET", "manager"), ctx); expect(await read.text()).not.toContain("synthetic-password-never-returned");
  const stale = await PUT(req("PUT", "manager", body), ctx); expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("STALE_UPDATE");
});
