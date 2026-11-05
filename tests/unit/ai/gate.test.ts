import { describe, expect, it } from "vitest";
import { AiGate, effectiveLimits, periodKeys, type AiJob, type AiLimits } from "@/modules/ai/domain/gate";
import { calculateCost, rubToMicros, type AiTariff } from "@/modules/ai/domain/cost";
import { InMemoryAiLedger } from "@/modules/ai/infrastructure/fake";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { loadConfig } from "@/shared/config/env";

const now = new Date("2026-11-05T18:00:00Z");
export const tariff: AiTariff = { id: "synthetic-rate", model: "demo-model", effectiveFrom: new Date("2026-01-01Z"),
  inputMicrosPerMillion: 1000000n, outputMicrosPerMillion: 2000000n, webSearchMicrosPerCall: 500n, webInputTokenAllowance: 10000 };
const limits: AiLimits = { enabled: true, webEnabled: true, autoFallback: false,
  requestsPerUserHour: 30, requestsPerUserDay: 240, callsPerJob: 10, webCallsPerJob: 1, webJobsPerUserDay: 3, monthlyBudgetMicros: 1000000000n };
const user = { userId: "u", active: true };
const job = (requestId = "r", id = "j"): AiJob => ({ id, ownerUserId: "u", requestId, fingerprint: requestId,
  model: tariff.model, tariff, estimatedUsage: { inputTokens: 100, outputTokens: 100 }, estimatedWebCalls: 0 });
function fixture(overrides: Partial<AiLimits> = {}) {
  const ledger = new InMemoryAiLedger();
  return { ledger, gate: new AiGate(ledger, { ...limits, ...overrides }, { getLimits: async () => ({}) }, "Asia/Novosibirsk", () => now) };
}

describe("AiGate atomic reservations", () => {
  it("denies disabled AI before any reservation", async () => {
    await expect(fixture({ enabled: false }).gate.check("parse", user, job())).rejects.toThrow("AI_DISABLED");
  });
  it("denies inactive user and foreign job", async () => {
    const { gate } = fixture();
    await expect(gate.check("parse", { ...user, active: false }, job())).rejects.toThrow("AI_FORBIDDEN");
    await expect(gate.check("parse", user, { ...job(), ownerUserId: "other" })).rejects.toThrow("AI_FORBIDDEN");
  });
  it.each(["requestsPerUserHour", "requestsPerUserDay", "callsPerJob"] as const)("enforces %s", async (key) => {
    const { gate } = fixture({ [key]: 1 });
    await gate.check("parse", user, job());
    await expect(gate.check("parse", user, job("r2"))).rejects.toThrow("AI_RATE_LIMIT");
  });
  it("reserves shared monthly budget under parallel calls", async () => {
    const { gate } = fixture({ monthlyBudgetMicros: 300n });
    const results = await Promise.allSettled([gate.check("parse", user, job("a")), gate.check("parse", user, job("b"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("refuses an exhausted budget", async () => {
    await expect(fixture({ monthlyBudgetMicros: 0n }).gate.check("parse", user, job())).rejects.toThrow("AI_BUDGET_EXHAUSTED");
  });
  it("does not reserve or settle twice, refuses changed idempotency content", async () => {
    const { gate, ledger } = fixture();
    await gate.check("parse", user, job());
    await expect(gate.check("parse", user, job())).rejects.toThrow("AI_ALREADY_RESERVED");
    await expect(gate.check("parse", user, { ...job(), fingerprint: "changed" })).rejects.toThrow("AI_IDEMPOTENCY_CONFLICT");
    await gate.settle("r", { usage: { inputTokens: 10, outputTokens: 20 }, webSearchCalls: 0, outcome: "success" });
    await gate.settle("r", { usage: { inputTokens: 1000, outputTokens: 2000 }, outcome: "success" });
    expect((await ledger.atomic((tx) => tx.find("r")))?.chargedMicros).toBe(50n);
  });
  it("keeps conservative reserve when usage is unavailable/timeout", async () => {
    const { gate, ledger } = fixture();
    await gate.check("parse", user, job());
    await gate.settle("r", { outcome: "error" });
    expect(await ledger.atomic((tx) => tx.find("r"))).toMatchObject({ chargedMicros: 300n, estimated: true, outcome: "error" });
  });
  it("enforces web per-job and per-day unique job quota", async () => {
    const { gate } = fixture({ webJobsPerUserDay: 1 });
    await gate.check("web_search", user, { ...job(), estimatedWebCalls: 1 });
    await expect(gate.check("web_search", user, { ...job("r2"), estimatedWebCalls: 1 })).rejects.toThrow("AI_WEB_LIMIT");
    await expect(gate.check("web_search", user, { ...job("r3", "j2"), estimatedWebCalls: 1 })).rejects.toThrow("AI_WEB_LIMIT");
  });
  it("requires web enable and explicit automatic full failure authorization", async () => {
    await expect(fixture({ webEnabled: false }).gate.check("web_search", user, { ...job(), estimatedWebCalls: 1 })).rejects.toThrow("AI_WEB_DISABLED");
    await expect(fixture().gate.check("web_search", user, { ...job(), estimatedWebCalls: 1, automaticWeb: true, fullTechnicalFailure: true })).rejects.toThrow("AI_WEB_DISABLED");
    await expect(fixture({ autoFallback: true }).gate.check("web_search", user, { ...job(), estimatedWebCalls: 1, automaticWeb: true, fullTechnicalFailure: false })).rejects.toThrow("AI_WEB_DISABLED");
  });
  it("uses tariff effective date and configured local day/month", async () => {
    await expect(fixture().gate.check("parse", user, { ...job(), tariff: { ...tariff, effectiveFrom: new Date("2027-01-01Z") } })).rejects.toThrow("AI_TARIFF_UNAVAILABLE");
    expect(periodKeys(now, "Asia/Novosibirsk").dayKey).toBe("2026-11-06");
    expect(periodKeys(new Date("2026-10-31T18:00:00Z"), "Asia/Novosibirsk").monthKey).toBe("2026-11");
  });
});

describe("money and env priority", () => {
  it("calculates exact tokens + search price and rounds up to a micro-RUB", () => {
    expect(calculateCost(tariff, { inputTokens: 100, outputTokens: 20 }, 2)).toBe(1140n);
    expect(calculateCost({ ...tariff, inputMicrosPerMillion: 1n }, { inputTokens: 1, outputTokens: 0 }, 0)).toBe(1n);
    expect(rubToMicros("1000.12")).toBe(1000120000n);
    expect(() => rubToMicros("-1")).toThrow();
    expect(() => calculateCost(tariff, { inputTokens: -1, outputTokens: 0 }, 0)).toThrow();
  });
  it("ENV ceilings override UI, including feature flags and budget", () => {
    expect(effectiveLimits({ ...limits, enabled: false }, { enabled: true, monthlyBudgetMicros: limits.monthlyBudgetMicros * 2n, requestsPerUserHour: 1000 }))
      .toMatchObject({ enabled: false, monthlyBudgetMicros: limits.monthlyBudgetMicros, requestsPerUserHour: 30 });
    expect(effectiveLimits(limits, { requestsPerUserHour: 1, monthlyBudgetMicros: 1n, webEnabled: false })).toMatchObject({ requestsPerUserHour: 1, monthlyBudgetMicros: 1n, webEnabled: false });
  });
  it("validates all §5 defaults, Novosibirsk, and rejects store=true and credential exfiltration URL", () => {
    const cfg = loadConfig({ DATABASE_URL: "synthetic" });
    expect(cfg.APP_TIMEZONE).toBe("Asia/Novosibirsk");
    expect(cfg.YANDEX_CLOUD_API_KEY).toBe("");
    expect(cfg.YANDEX_AI_STORE_RESPONSES).toBe(false);
    expect(envAiLimits(cfg)).toMatchObject({ enabled: false, webEnabled: false, monthlyBudgetMicros: 1000000000n });
    expect(() => loadConfig({ DATABASE_URL: "synthetic", YANDEX_AI_STORE_RESPONSES: "true" })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: "synthetic", YANDEX_CLOUD_BASE_URL: "https://invalid.example" })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: "synthetic", YANDEX_WEB_SEARCH_ALLOWED_DOMAINS: "https://example.com/path" })).toThrow();
  });
});
