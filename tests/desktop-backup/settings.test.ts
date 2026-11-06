import { afterEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BackupSettingsService } from "../../src/modules/desktop-backup/application/settings-service";
import { JsonSettingsRepository } from "../../src/modules/desktop-backup/infrastructure/settings-repository";
import { EncryptedFileCredentialStore, ServerAesProtector, WindowsDpapiProtector } from "../../src/modules/desktop-backup/infrastructure/credential-store";
import { defaultSettings } from "../../src/modules/desktop-backup/domain/settings";
const roots: string[] = []; const manager = { userId: randomUUID(), role: "manager" };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-backup-settings-")); roots.push(root);
  const secretRoot = path.join(root, "credentials"); const key = randomBytes(32).toString("base64");
  const credentials = new EncryptedFileCredentialStore(secretRoot, new ServerAesProtector(() => key));
  const service = new BackupSettingsService(new JsonSettingsRepository(root), credentials);
  return { root, secretRoot, key, credentials, service };
}
const schedule = defaultSettings().schedule, retention = defaultSettings().retention;
it("manager-only settings with write-only credentials; immutable secret references and optimistic concurrency", async () => {
  const a = await setup(); const id = randomUUID(); const secret = "synthetic-secret-never-returned";
  for (const role of ["realtor", "admin", "anonymous"]) {
    await expect(a.service.get({ ...manager, role })).rejects.toThrow("SETTINGS_FORBIDDEN");
    await expect(a.service.update({ ...manager, role }, {})).rejects.toThrow("SETTINGS_FORBIDDEN");
  }
  expect((await a.service.get(manager)).updatedAt).toBeNull();
  const input = { expectedUpdatedAt: null, schedule, retention, destinations: [{ id, kind: "yandex_s3", enabled: true, bucket: "synthetic-bucket", prefix: "synthetic", endpoint: "https://storage.yandexcloud.net", region: "ru-central1", credentials: { accessKeyId: "synthetic-key", secretAccessKey: secret } }] };
  const updated = await a.service.update(manager, input); expect(updated.destinations[0]?.credentialsConfigured).toBe(true);
  expect(JSON.stringify(updated)).not.toContain(secret); expect(JSON.stringify(updated)).not.toContain("secretRef");
  expect(await readFile(path.join(a.root, "destinations.v1.json"), "utf8")).not.toContain(secret);
  const refs = await readdir(a.secretRoot); expect(refs).toHaveLength(1);
  const encrypted = await readFile(path.join(a.secretRoot, refs[0]!), "utf8"); expect(encrypted).not.toContain(secret);
  const ref = refs[0]!.replace(".secret.json", ""); expect((await a.credentials.get(ref)).secretAccessKey).toBe(secret);
  await expect(a.service.update(manager, input)).rejects.toThrow("SETTINGS_STALE");
  const { credentials: _, ...unchanged } = input.destinations[0]!;
  const next = await a.service.update(manager, { ...input, expectedUpdatedAt: updated.updatedAt, destinations: [unchanged] });
  expect(next.destinations[0]?.credentialsConfigured).toBe(true);
  await expect(a.service.update(manager, { ...input, expectedUpdatedAt: next.updatedAt, destinations: [{ ...unchanged, clearCredentials: true }] })).rejects.toThrow("SETTINGS_CREDENTIALS_REQUIRED");
  const disabled = await a.service.update(manager, { ...input, expectedUpdatedAt: next.updatedAt, destinations: [{ ...unchanged, enabled: false, clearCredentials: true }] });
  expect(disabled.destinations[0]?.credentialsConfigured).toBe(false); expect(await readdir(a.secretRoot)).toHaveLength(0);
});
it("unknown fields, arbitrary endpoints and relative filesystem paths are rejected without leaking validation values", async () => {
  const a = await setup();
  for (const destinations of [
    [{ id: randomUUID(), kind: "local", enabled: true, directory: "../relative" }],
    [{ id: randomUUID(), kind: "mailru_webdav", enabled: true, endpoint: "http://169.254.169.254", email: "synthetic@example.invalid", prefix: "synthetic", partBytes: 1024 ** 2, useMove: true, applicationPassword: "synthetic-sensitive" }],
    [{ id: randomUUID(), kind: "local", enabled: true, directory: a.root, password: "synthetic-sensitive" }],
  ]) await expect(a.service.update(manager, { expectedUpdatedAt: null, schedule, retention, destinations })).rejects.toThrow(/^SETTINGS_/);
  expect((await a.service.get(manager)).updatedAt).toBeNull();
});
it("server encryption requires ENV key, detects wrong key and corruption, binds encrypted bytes to secret reference", async () => {
  const a = await setup(); expect(new ServerAesProtector(() => undefined).available).toBe(false);
  const ref = randomUUID(); await a.credentials.put(ref, { applicationPassword: "synthetic-password" });
  const wrong = new EncryptedFileCredentialStore(a.secretRoot, new ServerAesProtector(() => randomBytes(32).toString("base64")));
  await expect(wrong.get(ref)).rejects.toThrow("SECRET_STORE_INVALID");
  const file = path.join(a.secretRoot, ref + ".secret.json"); const encoded = JSON.parse(await readFile(file, "utf8")) as { data: string };
  const bytes = Buffer.from(encoded.data, "base64"); bytes[15] = bytes[15]! ^ 1; encoded.data = bytes.toString("base64"); await writeFile(file, JSON.stringify(encoded));
  await expect(a.credentials.get(ref)).rejects.toThrow("SECRET_STORE_INVALID");
});
it.runIf(process.platform === "win32")("DPAPI CurrentUser encrypts and decrypts synthetic credentials without storing plaintext", async () => {
  const a = await setup(); const dpapi = new EncryptedFileCredentialStore(a.secretRoot, new WindowsDpapiProtector()); const ref = randomUUID();
  await dpapi.put(ref, { applicationPassword: "synthetic-dpapi-only" });
  expect((await dpapi.get(ref)).applicationPassword).toBe("synthetic-dpapi-only");
  expect(await readFile(path.join(a.secretRoot, ref + ".secret.json"), "utf8")).not.toContain("synthetic-dpapi-only");
});
