import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { db, disconnectDb } from "../../../../src/shared/db/client";
import { createSession } from "../../../../src/modules/auth/application/session-service";
import { hashSessionToken } from "../../../../src/modules/auth/infrastructure/session-token";
import { decodeReservation, microsToRub } from "../../../../src/modules/ai/infrastructure/prisma-repositories";
import { SearchFilters } from "../../../../src/modules/property-search/domain/types";
import { evaluateListing } from "../../../../src/modules/property-search/domain/evaluation";
import { normalizeListing } from "../../../../src/modules/property-search/infrastructure/normalization";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
process.env.AI_ENABLED = "true";
const base = "http://localhost:3432", evidencePath = "docs/vkr/p0a-final-ai.json";
async function main() {
  const previous = await readFile(evidencePath, "utf8").catch(() => null);
  if (previous && (JSON.parse(previous).usage?.length || JSON.parse(previous).operations?.length)) throw Error("LIVE trial already dispatched; no automatic repeat");
  const user = await db.user.create({ data: { login: `p0a-${randomUUID().slice(0, 8)}`, displayName: "Приёмка P0-A", roleCode: "manager", isActive: true, mustChangePassword: false, passwordHash: await hash(randomUUID()) } });
  const session = await createSession(db, user.id, { userAgent: "P0-A final acceptance" });
  const startedAt = new Date();
  const before = await db.aiSetting.findFirstOrThrow();
  const settingKeys = ["aiEnabled", "scraperEnabled", "browserEnabled", "enabledSources", "webSearchManualAllowed", "webSearchAutoFallback", "model", "webModel", "searchContextSize", "perUserDailyLimit", "perJobLimit", "dailyLimit"] as const;
  const original = { ...Object.fromEntries(settingKeys.map(k => [k, before[k]])), monthlyBudgetRub: before.monthlyBudgetRub.toString() };
  const evidence: Record<string, unknown> = { mode: "LIVE", startedAt: startedAt.toISOString(), setupFailure: previous ? JSON.parse(previous) : null, database: "crm_demo", port: 3432, distDir: ".next-3432", maxAiCalls: 8, webSearchCalls: 0, settingsBefore: { perJobLimit: before.perJobLimit, monthlyBudgetRub: before.monthlyBudgetRub.toString() }, operations: [] };
  const operations = evidence.operations as unknown[];
  const record = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  const request = async (path: string, data?: unknown, method = "POST") => {
    if (path.includes("/analysis/")) {
      const count = await db.aiUsageLog.count({ where: { userId: user.id, createdAt: { gte: startedAt } } });
      if (count >= 8) throw Error("SESSION_AI_LIMIT");
    }
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Origin: base, Cookie: `crm_session=${session.token}` }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    if (!response.ok) throw Error(`${path}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 700)}`);
    return body.data ?? body;
  };
  try {
    const current = await request("/api/v1/settings/ai", undefined, "GET");
    await request("/api/v1/settings/ai", { ...original, expectedUpdatedAt: current.setting.updatedAt, aiEnabled: true, monthlyBudgetRub: "100", perJobLimit: 6, dailyLimit: Math.max(before.dailyLimit, 100), perUserDailyLimit: Math.max(before.perUserDailyLimit, 8) }, "PUT");
    evidence.settingsTemporary = { perJobLimit: 6, monthlyBudgetRub: "100", dailyLimit: Math.max(before.dailyLimit, 100), perUserDailyLimit: Math.max(before.perUserDailyLimit, 8) };
    await record();
    const rows = await db.externalListing.findMany({ where: { source: "onrealt", operation: "sale", sourceListingId: { not: "synthetic-101" }, description: { not: null } }, orderBy: { firstSeenAt: "asc" }, take: 4 });
    if (rows.length !== 4) throw Error("Need four real descriptions");
    const filters = SearchFilters.parse({ operation: "sale", purposes: ["office"], requiredFeatures: ["удобная планировка для учебного центра"], sources: ["onrealt"] });
    const selection = { listingIds: rows.map(r => r.id), filters };
    const batch = await request("/api/v1/property-search/analysis/batch", selection);
    operations.push({ kind: "batch", listingCount: rows.length, urls: rows.map(r => r.url), result: batch }); await record();
    const countBefore = await db.aiUsageLog.count({ where: { userId: user.id, createdAt: { gte: startedAt } } });
    const repeat = await request("/api/v1/property-search/analysis/batch", selection);
    const countAfter = await db.aiUsageLog.count({ where: { userId: user.id, createdAt: { gte: startedAt } } });
    operations.push({ kind: "repeat", cacheHits: repeat.items.map((i: { cacheHit: boolean }) => i.cacheHit), countBefore, countAfter, noPaidRepeat: countAfter === countBefore }); await record();
    const comparison = await request("/api/v1/property-search/analysis/compare", { ...selection, listingIds: selection.listingIds.slice(0, 3) });
    operations.push({ kind: "compare-three", result: comparison }); await record();
    const taskCountBefore = await db.task.count();
    const proposal = await request("/api/v1/property-search/analysis/suggest-tasks", { ...selection, listingIds: selection.listingIds.slice(0, 1) });
    const taskCountPreview = await db.task.count();
    const dueAt = new Date(Date.now() + 86400000).toISOString();
    const confirmed = await request("/api/v1/property-search/analysis/suggest-tasks/confirm", { pendingActionId: proposal.pendingActionId, confirmed: true, dueAt });
    const again = await request("/api/v1/property-search/analysis/suggest-tasks/confirm", { pendingActionId: proposal.pendingActionId, confirmed: true, dueAt });
    const created = await db.task.findMany({ where: { id: { in: confirmed.tasks.map((t: { id: string }) => t.id) } }, select: { id: true, title: true, status: true, dueAt: true, createdBy: true } });
    operations.push({ kind: "tasks", proposal, taskCountBefore, taskCountPreview, confirmed, again, created }); await record();
    const parse = await request("/api/v1/property-search/analysis/parse", { text: "Ищу офис для покупки в Новосибирске, от 50 до 100 квадратных метров. Остальные условия оставить.", currentFilters: filters });
    operations.push({ kind: "russian-query", result: parse });
    const residential = normalizeListing({ id: randomUUID(), source: "yandex", url: "https://realty.yandex.ru/offer/7567068812130613984/", title: "ЖК, квартира", description: "Продается однокомнатная квартира в жилом комплексе", deal: "sale", price: 1000000, area: 50, images: [], address: null, rooms: null, floor: null, phone: null, city: "Новосибирск", district: null, timestamp: new Date().toISOString() });
    operations.push({ kind: "residential-rule", mode: "DEMO negative control, not a LIVE scraped residential card", verdict: evaluateListing(residential, filters).verdict });
    for (const source of ["onrealt", "mirkvartir", "yandex"] as const) {
      const row = source === "onrealt" ? rows[0]! : await db.externalListing.findFirst({ where: { source, operation: "sale", sourceListingId: { not: "synthetic-101" } }, orderBy: { firstSeenAt: "desc" } });
      const url = source === "mirkvartir" ? "https://cre.mirkvartir.ru/369638218/" : row?.url;
      if (!url) continue;
      const manual = { title: "Офис — ручная проверка", operation: "sale", propertyType: "office", price: row?.priceRub ? Number(row.priceRub) : null, area: row?.areaM2 ? Number(row.areaM2) : null, city: "Новосибирск", address: row?.address ?? null, description: row?.description ?? "Характеристики требуют уточнения сотрудником" };
      const added = await request("/api/v1/property-search/listings/from-url", { url, filters, manual });
      const file = `url,title,operation,propertyType,price,area,city\n${url},Офис,sale,office,,,Новосибирск\n`;
      const feed = async (commit: boolean) => {
        const form = new FormData(); form.append("file", new Blob([file], { type: "text/csv" }), "listing.csv"); form.append("source", source); form.append("format", "csv"); form.append("filters", JSON.stringify(filters)); form.append("commit", String(commit));
        const response = await fetch(`${base}/api/v1/property-search/imports`, { method: "POST", headers: { Origin: base, Cookie: `crm_session=${session.token}` }, body: form });
        const body = await response.json(); if (!response.ok) throw Error(`Feed HTTP ${response.status}`); return body.data ?? body;
      };
      const preview = await feed(false), committed = await feed(true);
      operations.push({ kind: "fallback", source, url, manual: added, feedPreview: { rowsRead: preview.rowsRead, errors: preview.errors, count: preview.preview?.length }, feedCommit: { importedCount: committed.importedCount, committed: committed.committed }, mode: "LIVE CRM API, manually prepared CSV from real URL; not an official site export" }); await record();
    }
  } catch (error) { evidence.failure = error instanceof Error ? error.message : "LIVE_ACCEPTANCE_FAILED"; }
  finally {
    try {
      const current = await request("/api/v1/settings/ai", undefined, "GET");
      await request("/api/v1/settings/ai", { ...original, expectedUpdatedAt: current.setting.updatedAt }, "PUT");
      const restored = await db.aiSetting.findFirstOrThrow();
      evidence.settingsRestored = { perJobLimit: restored.perJobLimit, monthlyBudgetRub: restored.monthlyBudgetRub.toString(), matches: settingKeys.every(k => JSON.stringify(restored[k]) === JSON.stringify(before[k])) && restored.monthlyBudgetRub.equals(before.monthlyBudgetRub) };
    } finally {
      await db.userSession.updateMany({ where: { tokenHash: hashSessionToken(session.token) }, data: { revokedAt: new Date() } });
      await db.user.update({ where: { id: user.id }, data: { isActive: false } });
      evidence.sessionRevoked = true;
      const usage = await db.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: startedAt } }, orderBy: { createdAt: "asc" } });
      evidence.usage = usage.map(r => ({ id: r.id, callType: r.callType, status: r.status, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, webSearchCalls: r.webSearchCalls, actualRub: microsToRub(decodeReservation(r.result)?.actualMicros ?? 0n) }));
      evidence.actualRub = microsToRub(usage.reduce((s,r) => s + (decodeReservation(r.result)?.actualMicros ?? 0n), 0n));
      evidence.finishedAt = new Date().toISOString(); await record();
    }
  }
  console.log(JSON.stringify({ operations: operations.length, failure: evidence.failure, usage: evidence.usage, settingsRestored: evidence.settingsRestored, actualRub: evidence.actualRub }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "AI trial failed"); process.exitCode = 1; }).finally(disconnectDb);
