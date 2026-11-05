import { createHash } from "node:crypto";
import { db, Prisma, type Tx, type DbOrTx } from "@/shared/db/client";
import { AiError } from "../domain/contracts";
import { getConfig } from "@/shared/config/env";
import { envAiLimits } from "./config";
import { effectiveLimits, periodKeys } from "../domain/gate";
import { rubToMicros, type AiTariff, type TariffRepository } from "../domain/cost";
import type { AiLedgerRepository, AiLedgerTransaction, AiReservation, AiSettingsRepository, AiUsageSnapshot } from "../domain/gate";

export const AI_SETTING_ID = "00000000-0000-4000-8000-000000000005";
/** All writers, including settings/seed, share this transaction-scoped database lock. */
export async function lockAi(tx: Tx) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(241005::bigint)::text`; }
export async function singleton(tx: DbOrTx) {
  const rows = await tx.aiSetting.findMany({ take: 2 });
  if (rows.length > 1) throw new AiError("AI_SETTINGS_NOT_SINGLETON");
  return rows[0] ?? tx.aiSetting.create({ data: { id: AI_SETTING_ID } });
}
export function aiUsageLogId(requestId: string) {
  const h = createHash("sha256").update(`crm-ai:${requestId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function microsToRub(value: bigint): string { return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`; }
/** Legacy monetary columns have cents precision. Round UP; exact micro-RUB live in result JSONB. */
function centsCeil(value: bigint): string { return microsToRub(((value + 9999n) / 10000n) * 10000n); }
function encode(record: AiReservation): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ ledgerVersion: 1, ...record }, (_k, v) => typeof v === "bigint" ? v.toString() : v));
}
export function decodeReservation(value: Prisma.JsonValue | null): AiReservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.ledgerVersion !== 1) return null;
  const r = value as unknown as AiReservation;
  return { ...r, createdAt: new Date(r.createdAt), finishedAt: r.finishedAt ? new Date(r.finishedAt) : undefined,
    estimatedMicros: BigInt(r.estimatedMicros), chargedMicros: BigInt(r.chargedMicros), actualMicros: r.actualMicros === undefined ? undefined : BigInt(r.actualMicros),
    tariff: { ...r.tariff, effectiveFrom: new Date(r.tariff.effectiveFrom), effectiveUntil: r.tariff.effectiveUntil ? new Date(r.tariff.effectiveUntil) : undefined,
      inputMicrosPerMillion: BigInt(r.tariff.inputMicrosPerMillion), outputMicrosPerMillion: BigInt(r.tariff.outputMicrosPerMillion), webSearchMicrosPerCall: BigInt(r.tariff.webSearchMicrosPerCall) } };
}

export class PrismaAiLedger implements AiLedgerRepository {
  async atomic<T>(work: (tx: AiLedgerTransaction) => Promise<T>): Promise<T> {
    // READ COMMITTED intentionally: each read AFTER lock sees the previous holder's commit.
    // The shared advisory lock serializes the complete read/check/reserve/settle operation.
    return db.$transaction(async (tx) => { await lockAi(tx); await singleton(tx); return work(this.adapter(tx)); },
      { isolationLevel: "ReadCommitted", maxWait: 15000, timeout: 30000 });
  }
  private adapter(tx: Tx): AiLedgerTransaction {
    return {
      find: async (requestId) => {
        const row = await tx.aiUsageLog.findUnique({ where: { id: aiUsageLogId(requestId) } });
        const r = row ? decodeReservation(row.result) : null;
        if (row && (!r || r.requestId !== requestId)) throw new AiError("AI_IDEMPOTENCY_CONFLICT");
        return r;
      },
      usage: async (q) => {
        const rows = await tx.aiUsageLog.findMany({ where: { OR: [{ userId: q.userId }, { searchRunId: q.jobId },
          { createdAt: { gte: new Date(+new Date(`${q.monthKey}-01T00:00:00Z`) - 86400000) } }] } });
        const out: AiUsageSnapshot = { userHourCalls: 0, userDayCalls: 0, jobCalls: 0, jobWebCalls: 0, userDayWebJobIds: [], monthCommittedMicros: 0n };
        const jobs = new Set<string>(); out.dayCalls = 0;
        for (const row of rows) {
          const r = decodeReservation(row.result);
          if (!r) {
            // Legacy/unrecognized records must never silently disappear from the budget.
            const keys = periodKeys(row.createdAt, getConfig().APP_TIMEZONE);
            if (keys.monthKey === q.monthKey) out.monthCommittedMicros += rubToMicros((row.actualCostRub ?? row.estimatedCostRub).toString());
            if (keys.dayKey === q.dayKey) { out.dayCalls++; if (row.userId === q.userId) out.userDayCalls++; }
            if (row.userId === q.userId && row.createdAt >= q.hourSince) out.userHourCalls++;
            if (row.searchRunId === q.jobId) { out.jobCalls++; out.jobWebCalls += row.webSearchCalls; }
            continue;
          }
          if (r.monthKey === q.monthKey) out.monthCommittedMicros += r.chargedMicros;
          if (r.dayKey === q.dayKey) out.dayCalls++;
          if (r.userId === q.userId) {
            if (r.createdAt >= q.hourSince) out.userHourCalls++;
            if (r.dayKey === q.dayKey) { out.userDayCalls++; if ((r.callType === "web_search" || r.callType === "chat_web")) jobs.add(r.jobId); }
          }
          if (r.jobId === q.jobId) { out.jobCalls++; if ((r.callType === "web_search" || r.callType === "chat_web")) out.jobWebCalls += Math.max(r.estimatedWebCalls, r.webSearchCalls ?? 0); }
        }
        out.userDayWebJobIds = [...jobs]; return out;
      },
      insert: async (r) => {
        const limits = effectiveLimits(envAiLimits(getConfig()), settingsLimits(await singleton(tx)));
        const usage = await this.adapter(tx).usage({ userId: r.userId, jobId: r.jobId, dayKey: r.dayKey, monthKey: r.monthKey,
          hourSince: new Date(+r.createdAt - 3600000) });
        if (!limits.enabled) throw new AiError("AI_DISABLED");
        if ((r.callType === "web_search" || r.callType === "chat_web") && !limits.webEnabled) throw new AiError("AI_WEB_DISABLED");
        if (usage.monthCommittedMicros + r.estimatedMicros > limits.monthlyBudgetMicros) throw new AiError("AI_BUDGET_EXHAUSTED");
        if (usage.userHourCalls >= limits.requestsPerUserHour || usage.userDayCalls >= limits.requestsPerUserDay || usage.jobCalls >= limits.callsPerJob || (usage.dayCalls ?? 0) >= (limits.requestsPerDay ?? Infinity)) throw new AiError("AI_RATE_LIMIT");
        if ((r.callType === "web_search" || r.callType === "chat_web") && (usage.jobWebCalls + r.estimatedWebCalls > limits.webCallsPerJob ||
          (!usage.userDayWebJobIds.includes(r.jobId) && usage.userDayWebJobIds.length >= limits.webJobsPerUserDay))) throw new AiError("AI_WEB_LIMIT");
        const standalone = r.callType === "call_note" || r.callType === "offer_text" || r.callType === "chat" || r.callType === "chat_web";
        const run = standalone ? null : await tx.searchRun.findFirst({ where: { id: r.jobId, userId: r.userId } });
        const user = await tx.user.findFirst({ where: { id: r.userId, isActive: true } });
        if ((!standalone && !run) || !user) throw new AiError("AI_FORBIDDEN");
        await tx.aiUsageLog.create({ data: { id: aiUsageLogId(r.requestId), userId: r.userId, searchRunId: standalone ? null : r.jobId, callType: r.callType,
          model: r.model, estimatedCostRub: centsCeil(r.estimatedMicros), status: "running", result: encode(r), createdAt: r.createdAt,
          reservations: { create: { amountRub: centsCeil(r.estimatedMicros), status: "reserved" } } } });
      },
      update: async (r) => {
        await tx.aiUsageLog.update({ where: { id: aiUsageLogId(r.requestId) }, data: { inputTokens: r.usage?.inputTokens ?? 0,
          outputTokens: r.usage?.outputTokens ?? 0, webSearchCalls: r.webSearchCalls ?? 0,
          actualCostRub: r.actualMicros === undefined ? null : centsCeil(r.actualMicros), status: r.outcome ?? "error",
          durationMs: r.durationMs, result: encode(r) } });
        await tx.aiBudgetReservation.updateMany({ where: { usageLogId: aiUsageLogId(r.requestId), status: "reserved" },
          data: { status: r.chargedMicros === 0n && r.outcome === "error" ? "released" : "settled", amountRub: centsCeil(r.chargedMicros) } });
      },
    };
  }
  /** Only a verified pre-dispatch failure may release money; uncertain transport errors retain reserve. */
  async release(requestId: string, reason: "not_dispatched") {
    if (reason !== "not_dispatched") throw new AiError("AI_RELEASE_UNSAFE");
    await this.atomic(async (tx) => {
      const r = await tx.find(requestId);
      if (!r) throw new AiError("AI_RESERVATION_NOT_FOUND");
      if (r.state === "settled") return;
      const finishedAt = new Date();
      await tx.update({ ...r, state: "settled", outcome: "error", chargedMicros: 0n, actualMicros: 0n, estimated: false,
        usage: { inputTokens: 0, outputTokens: 0 }, webSearchCalls: 0, finishedAt, durationMs: finishedAt.getTime() - r.createdAt.getTime() });
    });
  }
}

export function settingsLimits(r: Awaited<ReturnType<typeof singleton>>) {
  return { enabled: r.aiEnabled, webEnabled: r.webSearchManualAllowed, autoFallback: r.webSearchAutoFallback,
    requestsPerUserDay: r.perUserDailyLimit, callsPerJob: r.perJobLimit, webCallsPerJob: r.perJobLimit,
    webJobsPerUserDay: r.perUserDailyLimit, requestsPerDay: r.dailyLimit, monthlyBudgetMicros: rubToMicros(r.monthlyBudgetRub.toString()) };
}
export class PrismaAiSettings implements AiSettingsRepository {
  async getLimits() {
    return db.$transaction(async (tx) => { await lockAi(tx); return settingsLimits(await singleton(tx)); });
  }
}
export class PrismaAiTariffs implements TariffRepository {
  async findEffective(model: string, at: Date): Promise<AiTariff | null> {
    const rows = await db.aiTariff.findMany({ where: { model, callType: "parse", effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: "desc" } });
    const first = rows[0]; if (!first) return null;
    const version = rows.filter((r) => r.effectiveFrom.getTime() === first.effectiveFrom.getTime());
    const price = (unit: string, perToken: string) => {
      const direct = version.find((r) => r.unit === unit)?.priceRub;
      const token = version.find((r) => r.unit === perToken)?.priceRub;
      return direct?.toString() ?? token?.mul(1000000).toFixed(6);
    };
    const input = price("input_million_tokens", "input_token"), output = price("output_million_tokens", "output_token"), web = price("web_search_call", "web_search_call");
    if (!input || !output || !web || rubToMicros(input) <= 0n || rubToMicros(output) <= 0n || rubToMicros(web) <= 0n) return null;
    const next = await db.aiTariff.findFirst({ where: { model, callType: "parse", effectiveFrom: { gt: at } }, orderBy: { effectiveFrom: "asc" } });
    return { id: first.id, model, effectiveFrom: first.effectiveFrom, effectiveUntil: next?.effectiveFrom,
      inputMicrosPerMillion: rubToMicros(input), outputMicrosPerMillion: rubToMicros(output), webSearchMicrosPerCall: rubToMicros(web),
      webInputTokenAllowance: 128000 };
  }
}
