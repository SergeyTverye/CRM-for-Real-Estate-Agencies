import { describe, expect, it, vi, afterEach } from "vitest";
import { completeDesktopSetup, desktopSetupStatus } from "@/modules/desktop-setup/application/setup-service";
describe("PostgreSQL server baseline", () => {
  afterEach(()=>vi.unstubAllEnvs());
  it("does not expose a public bootstrap account in server mode", async () => {
    vi.stubEnv("CRM_DEPLOYMENT_MODE","server");
    await expect(desktopSetupStatus()).rejects.toMatchObject({status:404});
    await expect(completeDesktopSetup({})).rejects.toMatchObject({status:404});
  });
});
