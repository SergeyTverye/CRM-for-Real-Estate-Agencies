import { AiError, type CallType, type TokenUsage } from "./contracts";
import { calculateCost, type AiTariff } from "./cost";

export interface AiLimits {
  enabled: boolean; webEnabled: boolean; autoFallback: boolean;
  requestsPerUserHour: number; requestsPerUserDay: number; callsPerJob: number;
  webCallsPerJob: number; webJobsPerUserDay: number; monthlyBudgetMicros: bigint;
  requestsPerDay?: number;
}
export interface AiUser { userId: string; active: boolean }
export interface AiJob {
  id: string; ownerUserId: string; requestId: string; fingerprint: string; model: string;
  automaticWeb?: boolean; fullTechnicalFailure?: boolean;
  estimatedUsage: TokenUsage; estimatedWebCalls: number; tariff: AiTariff;
}
export interface AiReservation {
  requestId: string; fingerprint: string; userId: string; jobId: string; callType: CallType;
  model: string; tariff: AiTariff; createdAt: Date; dayKey: string; monthKey: string;
  estimatedUsage: TokenUsage; estimatedWebCalls: number; estimatedMicros: bigint;
  chargedMicros: bigint; state: "reserved" | "settled";
  outcome?: "success" | "error"; usage?: TokenUsage; webSearchCalls?: number; estimated?: boolean;
  actualMicros?: bigint; finishedAt?: Date; durationMs?: number;
}
export interface AiUsageSnapshot {
  userHourCalls: number; userDayCalls: number; jobCalls: number; jobWebCalls: number;
  userDayWebJobIds: string[]; monthCommittedMicros: bigint;
  dayCalls?: number;
}
export interface AiLedgerTransaction {
  find(requestId: string): Promise<AiReservation | null>;
  usage(query: { userId: string; jobId: string; hourSince: Date; dayKey: string; monthKey: string }): Promise<AiUsageSnapshot>;
  insert(reservation: AiReservation): Promise<void>;
  update(reservation: AiReservation): Promise<void>;
}

export interface AiLedgerRepository { atomic<T>(work: (tx: AiLedgerTransaction) => Promise<T>): Promise<T> }
export interface AiSettingsRepository { getLimits(): Promise<Partial<AiLimits>> }


export function effectiveLimits(env: AiLimits, ui: Partial<AiLimits>): AiLimits {
  const n = (key: "requestsPerUserHour" | "requestsPerUserDay" | "callsPerJob" | "webCallsPerJob" | "webJobsPerUserDay") => {
    const value = ui[key] ?? env[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new AiError("AI_INVALID_LIMIT");
    return Math.min(env[key], value);
  };
  if ((ui.monthlyBudgetMicros ?? 0n) < 0n) throw new AiError("AI_INVALID_LIMIT");
  return {
    enabled: env.enabled && (ui.enabled ?? true), webEnabled: env.webEnabled && (ui.webEnabled ?? true),
    autoFallback: env.autoFallback && (ui.autoFallback ?? true),
    requestsPerUserHour: n("requestsPerUserHour"), requestsPerUserDay: n("requestsPerUserDay"), callsPerJob: n("callsPerJob"),
    webCallsPerJob: n("webCallsPerJob"), webJobsPerUserDay: n("webJobsPerUserDay"),
    monthlyBudgetMicros: ui.monthlyBudgetMicros === undefined || env.monthlyBudgetMicros < ui.monthlyBudgetMicros ? env.monthlyBudgetMicros : ui.monthlyBudgetMicros,
    requestsPerDay: Math.min(env.requestsPerDay ?? Number.MAX_SAFE_INTEGER, ui.requestsPerDay ?? Number.MAX_SAFE_INTEGER),
  };
}
export function periodKeys(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const monthKey = `${get("year")}-${get("month")}`;
  return { dayKey: `${monthKey}-${get("day")}`, monthKey };
}
export class AiGate {
  constructor(private readonly ledger: AiLedgerRepository, private readonly env: AiLimits,
    private readonly settings: AiSettingsRepository, private readonly timeZone = "Asia/Novosibirsk",
    private readonly clock: () => Date = () => new Date()) {}

  async check(callType: CallType, user: AiUser, job: AiJob, options: { reserve?: boolean } = {}): Promise<AiReservation> {
    const limits = effectiveLimits(this.env, await this.settings.getLimits());
    if (!limits.enabled) throw new AiError("AI_DISABLED");
    if (!user.active || job.ownerUserId !== user.userId) throw new AiError("AI_FORBIDDEN");
    if ((callType === "web_search" || callType === "chat_web") && (!limits.webEnabled || (job.automaticWeb && (!limits.autoFallback || !job.fullTechnicalFailure)))) throw new AiError("AI_WEB_DISABLED");
    const now = this.clock();
    if (job.tariff.model !== job.model || !Number.isFinite(job.tariff.effectiveFrom.getTime()) || job.tariff.effectiveFrom > now ||
      (job.tariff.effectiveUntil && (!Number.isFinite(job.tariff.effectiveUntil.getTime()) || job.tariff.effectiveUntil <= now))) throw new AiError("AI_TARIFF_UNAVAILABLE");
    if ((callType === "web_search" || callType === "chat_web") ? job.estimatedWebCalls < 1 : job.estimatedWebCalls !== 0) throw new AiError("AI_INVALID_USAGE");
    const estimatedMicros = calculateCost(job.tariff, job.estimatedUsage, job.estimatedWebCalls);
    return this.ledger.atomic(async (tx) => {
      const existing = await tx.find(job.requestId);
      if (existing) {
        if (existing.userId !== user.userId || existing.jobId !== job.id || existing.fingerprint !== job.fingerprint || existing.callType !== callType || existing.model !== job.model) throw new AiError("AI_IDEMPOTENCY_CONFLICT");
        
        throw new AiError("AI_ALREADY_RESERVED");
      }
      const keys = periodKeys(now, this.timeZone);
      const usage = await tx.usage({ userId: user.userId, jobId: job.id, hourSince: new Date(now.getTime() - 3600000), ...keys });
      if (usage.userHourCalls >= limits.requestsPerUserHour || usage.userDayCalls >= limits.requestsPerUserDay || usage.jobCalls >= limits.callsPerJob) throw new AiError("AI_RATE_LIMIT");
      if ((usage.dayCalls ?? 0) >= (limits.requestsPerDay ?? Number.MAX_SAFE_INTEGER)) throw new AiError("AI_RATE_LIMIT");
      if ((callType === "web_search" || callType === "chat_web") && (usage.jobWebCalls + job.estimatedWebCalls > limits.webCallsPerJob || (!usage.userDayWebJobIds.includes(job.id) && usage.userDayWebJobIds.length >= limits.webJobsPerUserDay))) throw new AiError("AI_WEB_LIMIT");
      if (usage.monthCommittedMicros + estimatedMicros > limits.monthlyBudgetMicros) throw new AiError("AI_BUDGET_EXHAUSTED");
      const reservation: AiReservation = {
        requestId: job.requestId, fingerprint: job.fingerprint, userId: user.userId, jobId: job.id, callType,
        model: job.model, tariff: job.tariff, createdAt: now, ...keys, estimatedUsage: job.estimatedUsage,
        estimatedWebCalls: job.estimatedWebCalls, estimatedMicros, chargedMicros: estimatedMicros, state: "reserved",
      };
      if (options.reserve !== false) await tx.insert(reservation);
      return reservation;
    });
  }

  async release(requestId: string): Promise<void> {
    
    await this.ledger.atomic(async (tx) => {
      const r = await tx.find(requestId);
      if (!r) throw new AiError("AI_RESERVATION_NOT_FOUND");
      if (r.state === "settled") return;
      const finishedAt = this.clock();
      await tx.update({ ...r, state: "settled", outcome: "error", chargedMicros: 0n, actualMicros: 0n, estimated: false,
        usage: { inputTokens: 0, outputTokens: 0 }, webSearchCalls: 0, finishedAt, durationMs: Math.max(0, +finishedAt - +r.createdAt) });
    });
  }

  async settle(requestId: string, result: { usage?: TokenUsage; webSearchCalls?: number; outcome: "success" | "error" }): Promise<void> {
    await this.ledger.atomic(async (tx) => {
      const record = await tx.find(requestId);
      if (!record) throw new AiError("AI_RESERVATION_NOT_FOUND");
      if (record.state === "settled") return;
      const estimated = !result.usage || ((record.callType === "web_search" || record.callType === "chat_web") && result.webSearchCalls === undefined);
      const webSearchCalls = result.webSearchCalls ?? record.estimatedWebCalls;
      const knownCost = calculateCost(record.tariff, result.usage ?? record.estimatedUsage, webSearchCalls);
      
      const chargedMicros = estimated && knownCost < record.estimatedMicros ? record.estimatedMicros : knownCost;
      const finishedAt = this.clock();
      await tx.update({ ...record, ...result, webSearchCalls, chargedMicros, estimated, actualMicros: estimated ? undefined : knownCost,
        finishedAt, durationMs: Math.max(0, finishedAt.getTime() - record.createdAt.getTime()), state: "settled" });
    });
  }
}
