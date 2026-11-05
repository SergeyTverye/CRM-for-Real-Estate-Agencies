import { describe, expect, it } from "vitest";
import { availableBudget, todayUsage } from "@/app/(crm)/settings/ai/usage-presentation";
import type { getAiUsage } from "@/modules/ai/application/settings-service";
type Item = Awaited<ReturnType<typeof getAiUsage>>["items"][number];
const item = (createdAt: string, override: Partial<Item> = {}): Item => ({
  id: "call", userId: "u1", user: "Сотрудник", jobId: "job1", callType: "parse", model: "test/model",
  inputTokens: 1, outputTokens: 1, webSearchCalls: 0, estimatedCostRub: "1", actualCostRub: null,
  chargedCostRub: "1", estimated: true, status: "running", createdAt, finishedAt: null, durationMs: null, ...override,
});
describe("AI settings presentation", () => {
  it("subtracts committed costs exactly, including sub-kopeck reservations", () => {
    expect(availableBudget("1000", "123.456789")).toBe("876.543211");
    expect(availableBudget("0.10", "0.03")).toBe("0.070000");
  });
  it("shows zero rather than a negative available balance", () => {
    expect(availableBudget("10", "10")).toBe("0.000000");
    expect(availableBudget("10", "11")).toBe("0.000000");
  });
  it("uses Novosibirsk midnight, independently of UTC day and month", () => {
    const today = todayUsage([item("2026-10-31T16:59:59Z"), item("2026-10-31T17:00:00Z"), item("2026-11-01T16:59:59Z"), item("2026-11-01T17:00:00Z")], new Date("2026-11-01T05:00:00Z"), "Asia/Novosibirsk");
    expect(today.day).toBe("2026-11-01");
    expect(today.calls).toBe(2);
  });
  it("counts reserved and failed calls and distinct web jobs per user", () => {
    const at = "2026-11-05T05:00:00Z";
    const today = todayUsage([item(at), item(at, { callType: "web_search" }), item(at, { callType: "web_search", status: "error" }), item(at, { callType: "web_search", jobId: "job2", userId: "u2" })], new Date(at), "Asia/Novosibirsk");
    expect(today.calls).toBe(4);
    expect(today.users.map(u => [u.userId, u.calls, u.webJobs])).toEqual([["u1", 3, 1], ["u2", 1, 1]]);
  });
  it("handles an empty usage ledger", () => {
    expect(todayUsage([], new Date("2026-11-05T05:00:00Z"), "Asia/Novosibirsk").users).toEqual([]);
  });
});
