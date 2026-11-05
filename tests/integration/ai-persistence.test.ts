import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { db, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { resetConfigCache, getConfig } from "@/shared/config/env";
import { AiGate } from "@/modules/ai/domain/gate";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs, decodeReservation } from "@/modules/ai/infrastructure/prisma-repositories";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { getAiSettings, getAiUsage, updateAiSettings } from "@/modules/ai/application/settings-service";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";
import type { AiSettingsInput } from "@/modules/ai/domain/settings";
let users: TestUsers;
beforeEach(async () => { resetConfigCache(); await resetDatabase(); users = await seedBase();
  await db.aiSetting.create({ data: { aiEnabled: true, perUserDailyLimit: 100, perJobLimit: 100, dailyLimit: 100, monthlyBudgetRub: "2.50" } }); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigCache(); });
const tariff = { id: "test", model: "test/latest", effectiveFrom: new Date("2020-01-01Z"), inputMicrosPerMillion: 1000000n,
  outputMicrosPerMillion: 1000000n, webSearchMicrosPerCall: 1000000n, webInputTokenAllowance: 128000 };
async function setup(user = users.realtor1) {
  const run = await db.searchRun.create({ data: { userId: user.userId, filters: {} } });
  const ledger = new PrismaAiLedger();
  const gate = new AiGate(ledger, envAiLimits(getConfig()), new PrismaAiSettings());
  const job = { id: run.id, ownerUserId: user.userId, requestId: randomUUID(), fingerprint: "synthetic-fingerprint", model: tariff.model, tariff,
    estimatedUsage: { inputTokens: 1000000, outputTokens: 0 }, estimatedWebCalls: 0 };
  return { ledger, gate, job, user: { userId: user.userId, active: true } };
}
function input(setting: Awaited<ReturnType<typeof getAiSettings>>["setting"]): AiSettingsInput {
  const { id: _id, updatedBy: _updatedBy, updatedAt, ...rest } = setting; void _id; void _updatedBy;
  return { ...rest, expectedUpdatedAt: updatedAt } as AiSettingsInput;
}
describe("persistent AI budget and settings", () => {
  it("serializes reservations across independent repository instances and never exceeds the shared budget", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const f = await setup(i % 2 ? users.realtor1 : users.realtor2);
      try { return await f.gate.check("parse", f.user, f.job); } catch { return null; }
    }));
    expect(attempts.filter(Boolean)).toHaveLength(2);
    const rows = await db.aiUsageLog.findMany(); expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + decodeReservation(row.result)!.chargedMicros, 0n)).toBe(2000000n);
    expect(await db.aiBudgetReservation.count({ where: { status: "reserved" } })).toBe(2);
  });
  it("settles exact micro-RUB, releases a verified unsent call, persists journal and remains idempotent", async () => {
    const f = await setup(); await f.gate.check("parse", f.user, f.job);
    await f.gate.settle(f.job.requestId, { usage: { inputTokens: 123, outputTokens: 0 }, webSearchCalls: 0, outcome: "success" });
    await f.gate.settle(f.job.requestId, { usage: { inputTokens: 99999, outputTokens: 0 }, outcome: "success" });
    const released = await setup(); await released.gate.check("description", released.user, released.job);
    await released.ledger.release(released.job.requestId, "not_dispatched");
    expect(await db.aiBudgetReservation.count({ where: { status: "released" } })).toBe(1);
    const journal = await getAiUsage(users.manager);
    expect(journal.committedRub).toBe("0.000123"); expect(journal.actualRub).toBe("0.000123");
    expect(journal.items.find((r) => r.callType === "parse")).toMatchObject({ inputTokens: 123, jobId: f.job.id, actualCostRub: "0.000123", status: "success" });
    await expect(f.gate.check("parse", f.user, f.job)).rejects.toThrow("AI_ALREADY_RESERVED");
    await expect(f.gate.check("parse", f.user, { ...f.job, fingerprint: "other" })).rejects.toThrow("AI_IDEMPOTENCY_CONFLICT");
  });
  it("retains the reserve for an uncertain provider error and enforces a global daily limit", async () => {
    await db.aiSetting.updateMany({ data: { dailyLimit: 1 } });
    const f = await setup(); await f.gate.check("parse", f.user, f.job);
    await f.gate.settle(f.job.requestId, { outcome: "error" });
    const second = await setup(users.realtor2);
    await expect(second.gate.check("parse", second.user, second.job)).rejects.toThrow("AI_RATE_LIMIT");
    const row = await db.aiUsageLog.findFirstOrThrow();
    expect(decodeReservation(row.result)).toMatchObject({ chargedMicros: 1000000n, actualMicros: undefined, estimated: true, outcome: "error" });
  });
  it("caps saved settings with ENV, audits updates and returns a stale-version conflict", async () => {
    vi.stubEnv("AI_ENABLED", "false"); vi.stubEnv("SCRAPER_ENABLED", "false"); vi.stubEnv("YANDEX_AI_MAX_MONTHLY_COST_RUB", "1"); resetConfigCache();
    const before = await getAiSettings(users.manager), body = { ...input(before.setting), monthlyBudgetRub: "9000", aiEnabled: true, scraperEnabled: true };
    const after = await updateAiSettings(users.manager, body);
    expect(after.effective.values).toMatchObject({ aiEnabled: false, scraperEnabled: false, monthlyBudgetRub: "1.000000" });
    expect(after.effective.restrictedByEnv).toEqual(expect.arrayContaining(["aiEnabled", "monthlyBudgetRub", "scraperEnabled"]));
    expect(await db.auditLog.count({ where: { action: "ai.settings.update" } })).toBe(1);
    await expect(updateAiSettings(users.manager, body)).rejects.toMatchObject({ code: "STALE_UPDATE" });
  });
  it("seeds positive versioned official rates idempotently; later versions never rewrite tariff snapshots", async () => {
    await db.$transaction(async (tx) => { await seedAiTariffs(tx); await seedAiTariffs(tx); });
    expect(await db.aiTariff.count()).toBe(6);
    expect(await db.auditLog.count({ where: { action: "ai.tariff.seed" } })).toBe(2);
    const repo = new PrismaAiTariffs();
    expect(await repo.findEffective("aliceai-llm-flash/latest", new Date("2026-11-06Z"))).toMatchObject({ inputMicrosPerMillion: 100000000n, outputMicrosPerMillion: 200000000n });
    const setting = await getAiSettings(users.manager);
    await updateAiSettings(users.manager, { ...input(setting.setting), tariffs: [{ model: "aliceai-llm-flash/latest", effectiveFrom: "2026-12-01T00:00:00Z", inputRubPerMillion: "150", outputRubPerMillion: "250", webRubPerCall: "1" }] });
    expect((await repo.findEffective("aliceai-llm-flash/latest", new Date("2026-11-15Z")))?.effectiveUntil).toEqual(new Date("2026-12-01Z"));
    expect((await repo.findEffective("aliceai-llm-flash/latest", new Date("2026-12-02Z")))?.inputMicrosPerMillion).toBe(150000000n);
    await expect(updateAiSettings(users.manager, { ...input((await getAiSettings(users.manager)).setting), tariffs: [{ model: "test/latest", effectiveFrom: "2026-12-01T00:00:00Z", inputRubPerMillion: "0", outputRubPerMillion: "1", webRubPerCall: "1" }] })).rejects.toThrow("больше нуля");
  });
});
