import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  actor: null as null | { userId: string; role: string; mustChangePassword: boolean },
  command: vi.fn(async () => ({ requestId: "00000000-0000-4000-8000-000000000001" })),
}));
vi.mock("@/modules/auth/application/session-service", () => ({ resolveSession: async () => mocks.actor }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ isReadOnlyInstance: false }) }));
vi.mock("@/shared/logging/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/desktop-backup/application/backup-control", () => ({ backupControlCommand: mocks.command, backupControlStatus: vi.fn() }));
import { POST } from "@/app/api/v1/settings/backups/control/route";
beforeEach(() => { mocks.actor = null; mocks.command.mockClear(); });
const host = "127.0.0.1:3511";
async function post(origin: string | null) {
  const headers: Record<string, string> = { host, "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return POST(new NextRequest("http://" + host + "/api/v1/settings/backups/control", { method: "POST", headers, body: JSON.stringify({ action: "pick-archive" }) }), { params: Promise.resolve({}) });
}
describe("native restore HTTP authorization and CSRF", () => {
  it("denies unauthenticated requests before creating any native request", async () => {
    expect((await post("http://" + host)).status).toBe(401); expect(mocks.command).not.toHaveBeenCalled();
  });
  it("denies realtors at actual route boundary", async () => {
    mocks.actor = { userId: "synthetic", role: "realtor", mustChangePassword: false };
    expect((await post("http://" + host)).status).toBe(403); expect(mocks.command).not.toHaveBeenCalled();
  });
  it.each([null, "https://evil.invalid"])("denies manager without trusted same-origin: %s", async origin => {
    mocks.actor = { userId: "synthetic", role: "manager", mustChangePassword: false };
    expect((await post(origin)).status).toBe(403); expect(mocks.command).not.toHaveBeenCalled();
  });
  it("passes same-origin manager to the fixed application command", async () => {
    mocks.actor = { userId: "synthetic", role: "manager", mustChangePassword: false };
    expect((await post("http://" + host)).status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith(mocks.actor, { action: "pick-archive" });
  });
});
