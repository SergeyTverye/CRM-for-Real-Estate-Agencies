import { describe, it, expect, vi } from "vitest";
import type { Actor } from "@/modules/auth/domain/actor";
import type { AppConfig } from "@/shared/config/env";
import type { CredentialStore } from "@/modules/desktop-backup/domain/settings";
import { AiCredentialsService } from "@/modules/ai/application/credentials-service";

const manager = { role: "manager" } as Actor, realtor = { role: "realtor" } as Actor;
const config = { YANDEX_CLOUD_API_KEY: "", YANDEX_CLOUD_FOLDER: "synthetic-folder" } as AppConfig;
function fakeStore() {
  let value: Record<string, string> | undefined;
  return { protection: "windows-dpapi-current-user", available: true,
    put: vi.fn(async (_ref: string, input: Record<string, string>) => { value = input; }),
    get: vi.fn(async () => { if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return value; }),
    delete: vi.fn(async () => { value = undefined; }),
  } satisfies CredentialStore;
}
describe("AI credential boundary (synthetic only)", () => {
  it("replaces and removes without caching or returning secrets", async () => {
    const store = fakeStore(), service = new AiCredentialsService(config, store);
    expect(await service.status(manager)).toMatchObject({ configured: false, status: "missing" });
    const status = await service.replace(manager, { apiKey: "synthetic-key-one", folder: "synthetic-folder" });
    expect(status).toEqual({ configured: true, source: "local", editable: true, status: "configured" });
    expect(JSON.stringify(status)).not.toMatch(/synthetic|apiKey|folder|secret|data/);
    await service.replace(manager, { apiKey: "synthetic-key-two", folder: "synthetic-folder" });
    expect((await service.resolve()).credentials?.apiKey).toBe("synthetic-key-two");
    expect(await service.remove(manager)).toMatchObject({ configured: false, status: "missing" });
  });
  it("keeps environment precedence and never reads local storage when ENV configured", async () => {
    const store = fakeStore(), service = new AiCredentialsService({ ...config, YANDEX_CLOUD_API_KEY: "synthetic-env-key" }, store);
    expect(await service.status(manager)).toMatchObject({ configured: true, source: "environment" });
    expect(store.get).not.toHaveBeenCalled();
    await service.remove(manager);
    expect((await service.resolve()).credentials?.apiKey).toBe("synthetic-env-key");
  });
  it("checks RBAC before parsing or accessing secrets", async () => {
    const store = fakeStore(), service = new AiCredentialsService(config, store);
    await expect(service.status(realtor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.replace(realtor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.remove(realtor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.get).not.toHaveBeenCalled(); expect(store.put).not.toHaveBeenCalled(); expect(store.delete).not.toHaveBeenCalled();
  });
  it("redacts validation and arbitrary adapter failures", async () => {
    const store = fakeStore(), service = new AiCredentialsService(config, store);
    await expect(service.replace(manager, { apiKey: "synthetic-secret\n", folder: "bad/folder" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    store.put.mockRejectedValueOnce(new Error("synthetic-secret provider path"));
    try { await service.replace(manager, { apiKey: "synthetic-secret", folder: "folder" }); expect.fail("must fail"); }
    catch (error) { expect(String(error)).not.toMatch(/synthetic-secret|provider path/); }
    store.get.mockRejectedValueOnce(new Error("synthetic-secret"));
    expect(await service.status(manager)).toMatchObject({ configured: false, status: "unavailable" });
  });
  it("fails closed when desktop protection is unavailable; server remains ENV-managed", async () => {
    const service = new AiCredentialsService(config, { ...fakeStore(), available: false });
    expect(await service.status(manager)).toMatchObject({ editable: false, status: "unavailable" });
    await expect(service.replace(manager, { apiKey: "synthetic-key", folder: "folder" })).rejects.toMatchObject({ status: 503 });
    expect(await new AiCredentialsService(config).status(manager)).toMatchObject({ editable: false, status: "missing" });
  });
});
