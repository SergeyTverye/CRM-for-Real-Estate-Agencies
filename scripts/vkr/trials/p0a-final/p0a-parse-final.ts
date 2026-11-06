/** Single authorized LIVE regression of spelled-out area; no network to listing sites. */
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, disconnectDb } from "../../../../src/shared/db/client";
import { createSession } from "../../../../src/modules/auth/application/session-service";
import { hashSessionToken } from "../../../../src/modules/auth/infrastructure/session-token";
import { decodeReservation, microsToRub } from "../../../../src/modules/ai/infrastructure/prisma-repositories";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const path = "docs/vkr/p0a-final-parse.json", base = "http://localhost:3432";
async function main() {
  if (await readFile(path, "utf8").catch(() => null)) throw Error("One-shot trial already exists");
  const user = await db.user.create({ data: { login: `p0a-${randomUUID().slice(0, 8)}`, displayName: "Приёмка P0-A: площадь", roleCode: "manager", passwordHash: await hash(randomUUID()), mustChangePassword: false } });
  const session = await createSession(db, user.id, {}), startedAt = new Date();
  const prior = await db.aiSetting.findFirstOrThrow();
  const original = { aiEnabled: prior.aiEnabled, scraperEnabled: prior.scraperEnabled, browserEnabled: prior.browserEnabled, enabledSources: prior.enabledSources, webSearchManualAllowed: prior.webSearchManualAllowed, webSearchAutoFallback: prior.webSearchAutoFallback, model: prior.model, webModel: prior.webModel, searchContextSize: prior.searchContextSize, perUserDailyLimit: prior.perUserDailyLimit, perJobLimit: prior.perJobLimit, dailyLimit: prior.dailyLimit, monthlyBudgetRub: prior.monthlyBudgetRub.toString() };
  const request = async (route: string, data?: unknown, method = "POST") => {
    const response = await fetch(`${base}${route}`, { method, headers: { Origin: base, Cookie: `crm_session=${session.token}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(120000) });
    const body = await response.json(); if (!response.ok) throw Error(`HTTP ${response.status}: ${JSON.stringify(body)}`); return body.data ?? body;
  };
  const evidence: Record<string, unknown> = { mode: "LIVE", startedAt: startedAt.toISOString(), maxAdditionalCalls: 1 };
  await writeFile(path, JSON.stringify(evidence, null, 2));
  try {
    const priorEvidence = JSON.parse(await readFile("docs/vkr/p0a-final-ai.json", "utf8"));
    const count = await db.aiUsageLog.count({ where: { createdAt: { gte: new Date(priorEvidence.startedAt) }, user: { login: { startsWith: "p0a-" } } } });
    if (count >= 8) throw Error("SESSION_AI_LIMIT");
    await request("/api/v1/settings/ai", { ...original, expectedUpdatedAt: prior.updatedAt.toISOString(), aiEnabled: true, monthlyBudgetRub: "100", dailyLimit: Math.max(100, prior.dailyLimit), perUserDailyLimit: Math.max(8, prior.perUserDailyLimit) }, "PUT");
    const result = await request("/api/v1/property-search/analysis/parse", { text: "Ищу офис для покупки в Новосибирске, от 50 до 100 квадратных метров. Остальные условия оставить.", currentFilters: { city: "Новосибирск", operation: "sale", purposes: ["office"], requiredFeatures: ["удобная планировка для учебного центра"], sources: ["onrealt"] } });
    evidence.result = result;
    evidence.areaVerified = result.filters?.areaFrom === 50 && result.filters?.areaTo === 100;
  } catch (error) { evidence.failure = error instanceof Error ? error.message : "FAILED"; }
  finally {
    try {
      const current = await request("/api/v1/settings/ai", undefined, "GET");
      await request("/api/v1/settings/ai", { ...original, expectedUpdatedAt: current.setting.updatedAt }, "PUT");
      const restored = await db.aiSetting.findFirstOrThrow();
      evidence.settingsRestored = restored.perJobLimit === prior.perJobLimit && restored.monthlyBudgetRub.equals(prior.monthlyBudgetRub) && restored.dailyLimit === prior.dailyLimit && restored.perUserDailyLimit === prior.perUserDailyLimit;
    } finally {
      await db.userSession.updateMany({ where: { tokenHash: hashSessionToken(session.token) }, data: { revokedAt: new Date() } });
      await db.user.update({ where: { id: user.id }, data: { isActive: false } });
      evidence.sessionRevoked = true;
      evidence.usage = (await db.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: startedAt } } })).map(r => ({ callType: r.callType, inputTokens: r.inputTokens, outputTokens: r.outputTokens, webSearchCalls: r.webSearchCalls, status: r.status, actualRub: microsToRub(decodeReservation(r.result)?.actualMicros ?? 0n) }));
      await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify(evidence));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "FAILED"); process.exitCode = 1; }).finally(disconnectDb);
