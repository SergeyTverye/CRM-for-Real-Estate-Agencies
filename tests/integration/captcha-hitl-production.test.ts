import { beforeAll, describe, it } from "vitest";
import { resetDatabase } from "../helpers/fixtures";
import { productionCycle } from "../fixtures/captcha-stand/production-cycle";

beforeAll(resetDatabase);
describe("AT-05/06 production SearchRun → HITL → parser → same run (DEMO)", () => {
  it.each(["success", "expired", "cancelled", "blocked", "foreign", "restart"] as const)("%s: real PostgreSQL, Chromium and authenticated API", async mode => {
    await productionCycle(mode);
  }, 45_000);
});
