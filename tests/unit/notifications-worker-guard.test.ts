import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: { isReadOnlyInstance: false }, transaction: vi.fn() }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => mocks.config }));
vi.mock("@/shared/db/client", () => ({ transaction: mocks.transaction, disconnectDb: vi.fn() }));
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
describe("notification worker fencing", () => {
  beforeEach(() => { mocks.config.isReadOnlyInstance = false; mocks.transaction.mockReset(); });
  it("never opens a writing transaction on standby", async () => {
    mocks.config.isReadOnlyInstance = true;
    expect(await generateNotifications()).toMatchObject({ active: false, delivered: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not generate without the transaction advisory lock", async () => {
    const query = vi.fn().mockResolvedValue([{ locked: false }]);
    mocks.transaction.mockImplementation(fn => fn({ $queryRaw: query }));
    expect(await generateNotifications()).toMatchObject({ active: true, locked: false, delivered: 0 });
    expect(query).toHaveBeenCalledOnce();
  });
});
