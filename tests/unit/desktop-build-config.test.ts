import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("keeps the server deployment output unchanged", async () => {
  vi.stubEnv("CRM_BUILD_TARGET","server");
  const {default:config}=await import("../../next.config");
  expect(config.output).toBeUndefined();
  expect(config.outputFileTracingExcludes).toBeUndefined();
});
it("enables standalone and excludes private input only for explicit desktop target", async () => {
  vi.stubEnv("CRM_BUILD_TARGET","desktop");
  const {default:config}=await import("../../next.config");
  expect(config.output).toBe("standalone");
  expect(config.outputFileTracingExcludes?.["/*"]).toContain("./.env*");
});
