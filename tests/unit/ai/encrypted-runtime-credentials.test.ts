import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as credentialsModule from "@/modules/ai/application/credentials-service";
import { AiCredentialsService } from "@/modules/ai/application/credentials-service";
import { CredentialNotFoundError, EncryptedFileCredentialStore, ServerAesProtector, type SecretProtector } from "@/modules/desktop-backup/infrastructure/credential-store";
import type { AppConfig } from "@/shared/config/env";
import type { Actor } from "@/modules/auth/domain/actor";
import { searchAvailability } from "@/modules/property-search/application/availability";

vi.mock("@/modules/property-search/application/dependencies", () => ({ searchSettings: async () => ({
  config: { AI_ENABLED: true, SCRAPER_ENABLED: true }, aiEnabled: true, enabled: true, sources: ["cian"],
  settings: { aiEnabled: true, scraperEnabled: true }, manualAllowed: true, autoFallback: true,
}) }));

const ref = "00000000-0000-4000-8000-000000000006";
const manager = { role: "manager" } as Actor;
const config = { CRM_DEPLOYMENT_MODE: "desktop", YANDEX_CLOUD_API_KEY: "", YANDEX_CLOUD_FOLDER: "" } as AppConfig;
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "synthetic-ai-store-")); roots.push(root);
  
  
  const aes = new ServerAesProtector(() => Buffer.alloc(32, 37).toString("base64"));
  const protector: SecretProtector = { available: true, protection: "windows-dpapi-current-user",
    seal: (bytes, context) => aes.seal(bytes, context), open: (bytes, context) => aes.open(bytes, context) };
  const store = new EncryptedFileCredentialStore(root, protector);
  const service = new AiCredentialsService(config, store);
  vi.spyOn(credentialsModule, "aiCredentialsService").mockReturnValue(service);
  return { root, store, service, file: path.join(root, ref + ".secret.json") };
}
describe("actual encrypted credential store readiness (synthetic)", () => {
  it("signals an empty available desktop store as missing, not unavailable", async () => {
    const { root, store, service } = await fixture();
    const error = await store.get(ref).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CredentialNotFoundError);
    expect(String(error)).toBe("BackupError: SECRET_STORE_NOT_FOUND");
    expect(String(error)).not.toContain(root);
    expect(await service.resolve()).toEqual({ credentials: null, source: "none", unavailable: false });
    expect(await service.status(manager)).toEqual({ configured: false, source: "none", editable: true, status: "missing" });
    expect((await searchAvailability()).ai).toMatchObject({ enabled: true, configured: false, available: false, reason: "credentials_missing", settingsUrl: "/settings/ai" });
  });
  it("encrypts, rotates and removes without leaking a secret through status or errors", async () => {
    const { store, service, file } = await fixture();
    const secret = "synthetic-only-api-key";
    const status = await service.replace(manager, { apiKey: secret, folder: "synthetic-folder" });
    expect(await readFile(file, "utf8")).not.toContain(secret);
    expect(JSON.stringify(status)).not.toMatch(/synthetic|apiKey|folder/);
    expect((await service.resolve()).credentials?.apiKey).toBe(secret);
    await service.replace(manager, { apiKey: "synthetic-rotated", folder: "synthetic-folder" });
    expect((await service.resolve()).credentials?.apiKey).toBe("synthetic-rotated");
    await service.remove(manager);
    await expect(store.get(ref)).rejects.toBeInstanceOf(CredentialNotFoundError);
    expect(await service.status(manager)).toMatchObject({ status: "missing" });
  });
  it("keeps malformed and undecryptable stores unavailable and redacted", async () => {
    const { root, store, service, file } = await fixture();
    for (const contents of ["synthetic-secret-invalid-json", JSON.stringify({ version: 1, protection: "windows-dpapi-current-user", data: Buffer.alloc(40).toString("base64") })]) {
      await writeFile(file, contents);
      await expect(store.get(ref)).rejects.toMatchObject({ code: "SECRET_STORE_INVALID", message: "SECRET_STORE_INVALID" });
      const status = await service.status(manager);
      expect(status).toEqual({ configured: false, source: "none", editable: true, status: "unavailable" });
      expect(JSON.stringify(status)).not.toContain(root);
      expect(JSON.stringify(status)).not.toMatch(/synthetic|data|path|apiKey/);
      expect(await service.resolve()).toEqual({ credentials: null, source: "none", unavailable: true });
      expect((await searchAvailability()).ai).toMatchObject({ enabled: true, configured: false, available: false, reason: "credential_store_unavailable" });
    }
  });
  it("does not treat protector failures with ENOENT as an absent credential", async () => {
    const { root, file } = await fixture();
    await writeFile(file, JSON.stringify({ version: 1, protection: "windows-dpapi-current-user", data: "AA==" }));
    const store = new EncryptedFileCredentialStore(root, { available: true, protection: "windows-dpapi-current-user",
      seal: async bytes => bytes,
      open: async () => { throw Object.assign(new Error("synthetic-secret-provider-path"), { code: "ENOENT" }); } });
    await expect(store.get(ref)).rejects.toMatchObject({ code: "SECRET_STORE_INVALID", message: "SECRET_STORE_INVALID" });
    expect(await new AiCredentialsService(config, store).status(manager)).toMatchObject({ status: "unavailable", configured: false });
  });
});
