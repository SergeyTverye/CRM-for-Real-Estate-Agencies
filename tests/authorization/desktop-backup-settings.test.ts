import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/v1/settings/backups/route";
import { defaultSettings } from "@/modules/desktop-backup/domain/settings";
import { apiRequest, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
let users: TestUsers; let root: string;
const original = { dir: process.env.BACKUP_SETTINGS_DIR, key: process.env.BACKUP_SETTINGS_MASTER_KEY };
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "crm-pg-backup-settings-"));
  process.env.BACKUP_SETTINGS_DIR = root; process.env.BACKUP_SETTINGS_MASTER_KEY = randomBytes(32).toString("base64");
});
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
afterAll(async () => {
  if (original.dir === undefined) delete process.env.BACKUP_SETTINGS_DIR; else process.env.BACKUP_SETTINGS_DIR = original.dir;
  if (original.key === undefined) delete process.env.BACKUP_SETTINGS_MASTER_KEY; else process.env.BACKUP_SETTINGS_MASTER_KEY = original.key;
  await rm(root, { recursive: true, force: true });
});
it("PG session: unauthenticated and realtor cannot access settings by direct URL", async () => {
  expect((await GET(apiRequest("GET", "/api/v1/settings/backups"), routeParams({}))).status).toBe(401);
  const cookie = await sessionCookieFor(users.realtor1);
  expect((await GET(apiRequest("GET", "/api/v1/settings/backups", { cookie }), routeParams({}))).status).toBe(403);
  expect((await PUT(apiRequest("PUT", "/api/v1/settings/backups", { cookie, body: {} }), routeParams({}))).status).toBe(403);
});
it("PG manager session updates schedule/clouds without reading stored secrets; CSRF enforced", async () => {
  const cookie = await sessionCookieFor(users.manager);
  const read = await GET(apiRequest("GET", "/api/v1/settings/backups", { cookie }), routeParams({})); expect(read.status).toBe(200);
  const dto = await read.json(); const initial = defaultSettings();
  const body = { expectedUpdatedAt: dto.updatedAt, schedule: initial.schedule, retention: initial.retention, destinations: [{ id: randomUUID(), kind: "yandex_s3", enabled: true, bucket: "synthetic-bucket", prefix: "synthetic", endpoint: "https://storage.yandexcloud.net", region: "ru-central1", credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret-no-browser" } }] };
  expect((await PUT(apiRequest("PUT", "/api/v1/settings/backups", { cookie, body, origin: "https://evil.invalid" }), routeParams({}))).status).toBe(403);
  const updated = await PUT(apiRequest("PUT", "/api/v1/settings/backups", { cookie, body }), routeParams({})); expect(updated.status).toBe(200);
  expect(await updated.text()).not.toContain("synthetic-secret-no-browser");
  expect((await PUT(apiRequest("PUT", "/api/v1/settings/backups", { cookie, body }), routeParams({}))).status).toBe(409);
});
