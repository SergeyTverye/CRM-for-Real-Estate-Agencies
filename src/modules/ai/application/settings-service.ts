import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { db } from "@/shared/db/client";
import { getConfig, type AppConfig } from "@/shared/config/env";
import { ForbiddenError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { parseInput } from "@/shared/validation";
import { aiSettingsInput } from "../domain/settings";
import { effectiveLimits, periodKeys } from "../domain/gate";
import { rubToMicros } from "../domain/cost";
import { envAiLimits } from "../infrastructure/config";
import { decodeReservation, lockAi, microsToRub, PrismaAiLedger, settingsLimits, singleton } from "../infrastructure/prisma-repositories";

function manager(actor: Actor) { if (actor.role !== "manager") throw new ForbiddenError(); }
async function readSetting() { return db.$transaction(async (tx) => { await lockAi(tx); return singleton(tx); }); }
export function effectiveAiSettings(row: Awaited<ReturnType<typeof singleton>>, config: AppConfig) {
  const limits = effectiveLimits(envAiLimits(config), settingsLimits(row));
  const rank = { low: 0, medium: 1, high: 2 };
  const context = row.searchContextSize as keyof typeof rank;
  const searchContextSize = rank[context] <= rank[config.YANDEX_WEB_SEARCH_CONTEXT_SIZE] ? context : config.YANDEX_WEB_SEARCH_CONTEXT_SIZE;
  const values = { aiEnabled: limits.enabled, scraperEnabled: config.SCRAPER_ENABLED && row.scraperEnabled,
    browserEnabled: config.SCRAPER_BROWSER_ENABLED && row.browserEnabled,
    enabledSources: row.enabledSources, webSearchManualAllowed: limits.webEnabled, webSearchAutoFallback: limits.autoFallback,
    model: row.model, webModel: row.webModel || config.YANDEX_CLOUD_WEB_MODEL || row.model, searchContextSize,
    perUserDailyLimit: limits.requestsPerUserDay, perJobLimit: limits.callsPerJob,
    dailyLimit: Math.min(row.dailyLimit, config.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR * 8), monthlyBudgetRub: microsToRub(limits.monthlyBudgetMicros) };
  const restrictedByEnv = Object.keys(values).filter((key) => {
    if (key === "monthlyBudgetRub") return rubToMicros(row.monthlyBudgetRub.toString()) > limits.monthlyBudgetMicros;
    return key in row && JSON.stringify(row[key as keyof typeof row]) !== JSON.stringify(values[key as keyof typeof values]);
  });
  return { values, restrictedByEnv, limits };
}
export async function getAiSettings(actor: Actor) {
  manager(actor);
  const row = await readSetting();
  const { limits: _limits, ...effective } = effectiveAiSettings(row, getConfig());
  void _limits;
  const tariffs = await db.aiTariff.findMany({ orderBy: [{ effectiveFrom: "desc" }, { model: "asc" }, { unit: "asc" }], take: 200 });
  return { setting: { ...row, monthlyBudgetRub: row.monthlyBudgetRub.toString(), updatedAt: row.updatedAt.toISOString() },
    effective, tariffs: tariffs.map((r) => ({ ...r, priceRub: r.priceRub.toString(), effectiveFrom: r.effectiveFrom.toISOString() })) };
}
export async function updateAiSettings(actor: Actor, input: unknown) {
  manager(actor);
  const { expectedUpdatedAt, tariffs, ...data } = parseInput(aiSettingsInput, input);
  if (new Set(data.enabledSources).size !== data.enabledSources.length) throw new ValidationError("Площадка указана повторно");
  await db.$transaction(async (tx) => {
    await lockAi(tx);
    const before = await singleton(tx);
    const updated = await tx.aiSetting.updateMany({ where: { id: before.id, updatedAt: new Date(expectedUpdatedAt) },
      data: { ...data, updatedBy: actor.userId, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) } });
    if (!updated.count) throw new StaleUpdateError();
    for (const tariff of tariffs ?? []) {
      for (const value of [tariff.inputRubPerMillion, tariff.outputRubPerMillion, tariff.webRubPerCall])
        if (rubToMicros(value) <= 0n) throw new ValidationError("Цена тарифа должна быть больше нуля");
      const effectiveFrom = new Date(tariff.effectiveFrom);
      // Versioned append-only rates preserve the meaning of settled usage and historical dates.
      const latest = await tx.aiTariff.findFirst({ where: { model: tariff.model }, orderBy: { effectiveFrom: "desc" } });
      if (latest && latest.effectiveFrom >= effectiveFrom) throw new ValidationError("Новая версия тарифа должна иметь более позднюю дату действия");
      await tx.aiTariff.createMany({ data: [
        { model: tariff.model, callType: "parse", unit: "input_million_tokens", priceRub: tariff.inputRubPerMillion, effectiveFrom },
        { model: tariff.model, callType: "parse", unit: "output_million_tokens", priceRub: tariff.outputRubPerMillion, effectiveFrom },
        { model: tariff.model, callType: "parse", unit: "web_search_call", priceRub: tariff.webRubPerCall, effectiveFrom },
      ] });
    }
    await writeAudit(tx, { actorUserId: actor.userId, action: "ai.settings.update", entityType: "AiSetting", entityId: before.id,
      before, after: { ...data, tariffs } });
  });
  return getAiSettings(actor);
}

export async function getAiUsage(actor: Actor, raw: unknown = {}) {
  manager(actor);
  const config = getConfig();
  const input = parseInput(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict(), raw);
  const month = input.month ?? periodKeys(new Date(), config.APP_TIMEZONE).monthKey;
  const start = new Date(`${month}-01T00:00:00Z`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  // Include UTC margins, then use the exact local-month key (including DST).
  const rows = await db.aiUsageLog.findMany({ where: { createdAt: { gte: new Date(+start - 86400000), lt: new Date(+end + 86400000) } },
    include: { user: { select: { displayName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  let committed = 0n, actual = 0n, reserved = 0n;
  const items = rows.filter((r) => periodKeys(r.createdAt, config.APP_TIMEZONE).monthKey === month).map((r) => {
    const record = decodeReservation(r.result);
    const charged = record?.chargedMicros ?? rubToMicros((r.actualCostRub ?? r.estimatedCostRub).toString());
    committed += charged; actual += record?.actualMicros ?? (r.actualCostRub ? rubToMicros(r.actualCostRub.toString()) : 0n);
    if (record?.state === "reserved") reserved += charged;
    return { id: r.id, userId: r.userId, user: r.user.displayName, jobId: r.searchRunId, callType: r.callType, model: r.model,
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, webSearchCalls: r.webSearchCalls,
      estimatedCostRub: record ? microsToRub(record.estimatedMicros) : r.estimatedCostRub.toString(),
      actualCostRub: record?.actualMicros !== undefined ? microsToRub(record.actualMicros) : r.actualCostRub?.toString() ?? null,
      chargedCostRub: microsToRub(charged), estimated: record?.estimated ?? r.actualCostRub === null,
      status: r.status, createdAt: r.createdAt.toISOString(), finishedAt: record?.finishedAt?.toISOString() ?? null, durationMs: r.durationMs };
  });
  return { month, page: input.page, pageSize: 50, total: items.length, committedRub: microsToRub(committed), actualRub: microsToRub(actual),
    reservedRub: microsToRub(reserved), items: items.slice((input.page - 1) * 50, input.page * 50) };
}
export async function getAiLimits(actor: Actor) {
  const config = getConfig(), now = new Date(), keys = periodKeys(now, config.APP_TIMEZONE);
  const effective = effectiveAiSettings(await readSetting(), config);
  const usage = await new PrismaAiLedger().atomic((tx) => tx.usage({ userId: actor.userId, jobId: "00000000-0000-4000-8000-000000000000",
    hourSince: new Date(+now - 3600000), ...keys }));
  const l = effective.limits;
  return { modes: { ai: l.enabled, manualWeb: l.enabled && l.webEnabled, automaticWeb: l.enabled && l.webEnabled && l.autoFallback,
    scraper: effective.values.scraperEnabled, browser: effective.values.browserEnabled, sources: effective.values.enabledSources },
    remaining: { hour: Math.max(0, l.requestsPerUserHour - usage.userHourCalls), day: Math.max(0, Math.min(l.requestsPerUserDay - usage.userDayCalls,
      (l.requestsPerDay ?? Number.MAX_SAFE_INTEGER) - (usage.dayCalls ?? 0))),
      webJobsToday: Math.max(0, l.webJobsPerUserDay - usage.userDayWebJobIds.length) },
    budgetAvailable: usage.monthCommittedMicros < l.monthlyBudgetMicros };
}
