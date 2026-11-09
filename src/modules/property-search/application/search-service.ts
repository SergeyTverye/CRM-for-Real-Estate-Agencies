import { lockSql } from "@/shared/db/dialect";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, Prisma, type Tx } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { ConflictError, NotFoundError } from "@/shared/errors";
import { AiError } from "@/modules/ai/domain/contracts";
import { logger } from "@/shared/logging/logger";
import type { Actor } from "@/modules/auth/domain/actor";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { writeAudit } from "@/modules/audit/application/audit";
import { SearchFilters, SOURCES, type NormalizedListing, type ListingEvaluation, type SearchResult } from "../domain/types";
import { evaluateListing, analyzeUnresolved } from "../domain/evaluation";
import { decideFallback } from "../domain/fallback";
import { guardExternalUrl } from "@/shared/net/ssrf";
import { getSearchAi, scraperFor, searchSettings, type SearchAiPort } from "./dependencies";
import type { ScraperAdapter } from "../infrastructure/scraper-adapter";
import { stableListingId } from "./listing-identity";
import { pricePerM2 } from "../domain/prices";
import { regroupRunListings } from "./duplicate-ingestion";

export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const priceUnits = { rub_total: "total", rub_month: "per_month", rub_year: "per_year", rub_m2_month: "per_m2_month", rub_m2_year: "per_m2_year" } as const;
const runInput = z.object({ filters: SearchFilters, sources: z.array(z.enum(SOURCES)).max(7), needId: zUuid.optional(), savedSearchId: zUuid.optional(),
  confirmedPaid: z.boolean().default(false), demoScenario: z.enum(["success", "partial", "failure", "empty"]).default("success") }).strict();
export const aiContext = (actor: Actor, jobId: string) => ({ user: { userId: actor.userId, active: true }, jobId, ownerUserId: actor.userId, requestId: randomUUID() });
export async function searchAudit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, after?: Record<string, unknown>) {
  await writeAudit(tx, { actorUserId: actor.userId, action: `property_search.${action}`, entityType, entityId, after });
}
export async function accessibleRun(actor: Actor, id: string) {
  parseInput(zUuid, id);
  const run = await db.searchRun.findFirst({ where: { id, userId: actor.userId } });
  if (!run) throw new NotFoundError();
  if (run.needId) await loadAccessibleNeed(db, actor, run.needId);
  return run;
}
export async function getSearchRun(actor: Actor, id: string) {
  const run = await accessibleRun(actor, id);
  const [sources, results] = await Promise.all([
    db.searchRunSource.findMany({ where: { runId: id } }),
    db.searchRunResult.findMany({ where: { runId: id }, orderBy: [{ score: "desc" }, { id: "asc" }],
      include: { listing: { include: { verifications: { orderBy: { verifiedAt: "desc" }, take: 1,
        select: { availability: true, priceConfirmed: true, ownerConfirmed: true, verifiedAt: true, verifiedBy: true, nextCheckAt: true, note: true } } } } } }),
  ]);
  
  const snapshots = await db.externalListingSnapshot.findMany({ where: { searchRunId: id }, orderBy: { fetchedAt: "desc" } });
  return { ...run, sources, results: results.map(row => ({ ...row, snapshot: snapshots.find(s => s.listingId === row.listingId)?.normalized ?? null })), demoMode: (await searchSettings()).config.SCRAPER_DEMO_FIXTURES };
}

export async function persistListing(tx: Tx, runId: string, listing: NormalizedListing, evaluation: ListingEvaluation, previousRunId: string | null, sourceMethod: "scraper" | "web_search" | "manual" = "scraper", sourceOverride?: string) {
  const source = sourceOverride ?? listing.source;
  listing = { ...listing, sourceListingId: stableListingId(listing.sourceListingId, listing.url),
    identityNeedsReview: listing.identityNeedsReview || !listing.sourceListingId };
  
  
  await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([source, listing.sourceListingId, listing.sourceUnitId])}, 0))`));
  const existing = listing.sourceListingId ? await tx.externalListing.findFirst({ where: { source, sourceListingId: listing.sourceListingId, sourceUnitId: listing.sourceUnitId } }) : null;
  const perM2 = pricePerM2(listing.price, listing.priceUnit, listing.area);
  const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
  const observations = { publishedAt: date(listing.publishedAt), sourceUpdatedAt: date(listing.sourceUpdatedAt),
    
    dateSource: ["site_published", "site_updated", "relative_label", "first_seen", "unknown"].includes(listing.dateSource ?? "") ? listing.dateSource! : listing.dateSource?.includes("html_label") ? "relative_label" : listing.publishedAt ? "site_published" : listing.sourceUpdatedAt ? "site_updated" : "unknown", datePrecision: listing.datePrecision ?? "unknown",
    sourceCategoryRaw: listing.sourceCategoryRaw ?? null, purposeEvidence: listing.purposeEvidence ? jsonValue(listing.purposeEvidence) : Prisma.JsonNull,
    pricePerM2Rub: perM2?.amount ?? null, pricePerM2Unit: perM2?.unit ?? null };
  const data = { ...observations, fetchedAt: new Date(listing.fetchedAt), source, sourceListingId: listing.sourceListingId, sourceUnitId: listing.sourceUnitId, url: listing.url, sourceMethod,
    operation: listing.operation ?? "sale", priceUnit: listing.priceUnit ? priceUnits[listing.priceUnit] : null, priceRub: listing.price,
    
    
    
    areaM2: listing.area !== null && Number.isFinite(listing.area) && listing.area > 0 ? new Prisma.Decimal(String(listing.area)).toFixed(2) : null, floorRaw: listing.floor.raw, floorNumber: listing.floor.number, purposes: listing.purpose ? [listing.purpose] : [],
    address: listing.address, district: listing.district, city: listing.city ?? "", sellerType: listing.seller.type,
    description: listing.description, images: jsonValue(listing.images), lastSeenAt: new Date(listing.fetchedAt) };
  const row = existing ? await tx.externalListing.update({ where: { id: existing.id }, data: { ...data, lastPrice: existing.priceRub } }) : await tx.externalListing.create({ data: { ...data, firstSeenAt: new Date(listing.fetchedAt) } });
  let previousResult = previousRunId ? await tx.searchRunResult.findUnique({ where: { runId_listingId: { runId: previousRunId, listingId: row.id } } }) : null;
  if (previousRunId && !previousResult) {
    const run = await tx.searchRun.findUniqueOrThrow({ where: { id: runId } });
    
    previousResult = await tx.searchRunResult.findFirst({ where: { listingId: row.id, run: { userId: run.userId, startedAt: { lt: run.startedAt }, ...(run.savedSearchId ? { savedSearchId: run.savedSearchId } : { savedSearchId: null, filters: { equals: run.filters as Prisma.InputJsonValue } }) } }, orderBy: [{ run: { startedAt: "desc" } }, { id: "desc" }] });
  }
  const prior = previousResult ? await tx.externalListingSnapshot.findFirst({ where: { searchRunId: previousResult.runId, listingId: row.id }, orderBy: [{ fetchedAt: "desc" }, { id: "asc" }] }) : null;
  
  const snapshot = await tx.externalListingSnapshot.findFirst({ where: { listingId: row.id, searchRunId: runId, fetchedAt: new Date(listing.fetchedAt) } });
  if (!snapshot) await tx.externalListingSnapshot.create({ data: { ...observations, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, areaM2: data.areaM2, lastCheckedAt: row.lastCheckedAt,
    listingId: row.id, searchRunId: runId, fetchedAt: new Date(listing.fetchedAt), priceRub: listing.price, normalized: jsonValue({ ...listing, firstSeenAt: row.firstSeenAt.toISOString(), source, sourceMethod, pricePerM2: perM2 }) } });
  const comparable = prior?.priceRub !== null && listing.price !== null && !!listing.priceUnit && (prior?.normalized as { priceUnit?: string } | undefined)?.priceUnit === listing.priceUnit;
  await tx.searchRunResult.upsert({ where: { runId_listingId: { runId, listingId: row.id } },
    create: { runId, listingId: row.id, verdict: evaluation.verdict, criteria: jsonValue([...evaluation.criteria, ...evaluation.preferences]), score: evaluation.score,
      isNew: !previousResult, priceChanged: !!prior && comparable && prior.priceRub?.toString() !== new Prisma.Decimal(listing.price!).toString() },
    update: { verdict: evaluation.verdict, criteria: jsonValue([...evaluation.criteria, ...evaluation.preferences]), score: evaluation.score } });
}

export async function runSearch(actor: Actor, raw: unknown, dependencies?: { scraper?: ScraperAdapter; ai?: SearchAiPort | null }) {
  const input = parseInput(runInput, raw);
  const filters = { ...input.filters, sources: [...new Set(input.sources)] };
  let needId = input.needId;
  let previousRunId: string | null = null;
  if (input.savedSearchId) {
    const saved = await db.savedSearch.findFirst({ where: { id: input.savedSearchId, ownerUserId: actor.userId } });
    if (!saved) throw new NotFoundError();
    if (saved.needId) await loadAccessibleNeed(db, actor, saved.needId);
    if (needId && needId !== saved.needId) throw new ConflictError("SEARCH_NEED_MISMATCH", "Потребность отличается от сохранённого поиска");
    needId = saved.needId ?? needId;
    previousRunId = saved.lastSuccessfulRunId;
  }
  if (needId) await loadAccessibleNeed(db, actor, needId);
  const settings = await searchSettings();
  const composedAi = settings.aiEnabled ? dependencies?.ai ?? await getSearchAi() : null;
  
  
  const ai = composedAi?.configured === false ? null : composedAi;
  if (ai && !input.confirmedPaid) throw new ConflictError("PAID_CONFIRMATION_REQUIRED", "Подтвердите условия и возможный платный анализ/резервный поиск");
  const run = await db.searchRun.create({ data: { userId: actor.userId, needId, savedSearchId: input.savedSearchId, city: filters.city, filters: jsonValue(filters), status: "running" } });
  try {
    const adapter = dependencies?.scraper ?? scraperFor(settings, input.demoScenario);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result: SearchResult = await Promise.race([
      adapter.search(filters),
      
      
      new Promise<SearchResult>(resolve => { timer = setTimeout(() => resolve({ listings: [], sources: filters.sources.map(source => ({ source, status: "timeout", resultCount: 0, reason: "Превышен срок выполнения задания" })) }), settings.config.SCRAPER_JOB_TIMEOUT_MS + 2000); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    for (const item of result.listings) {
      
      delete item.listing.seller.ownerVerification;
      const existing = item.listing.sourceListingId ? await db.externalListing.findFirst({ where: { source: item.listing.source, sourceListingId: item.listing.sourceListingId, sourceUnitId: item.listing.sourceUnitId },
        include: { verifications: { orderBy: { verifiedAt: "desc" }, take: 1 } } }) : null;
      const verification = existing?.verifications[0];
      if (verification?.ownerConfirmed === true) item.listing.seller.ownerVerification = { source: "employee", method: "employee_check", checkedAt: verification.verifiedAt.toISOString(), verifiedBy: verification.verifiedBy };
      item.evaluation = evaluateListing(item.listing, filters);
      if (ai && item.evaluation.aiPending.length) {
        try { item.evaluation = await analyzeUnresolved(item.listing, item.evaluation, { analyze: async ({ description, criteria }) => {
          const analyzed = await ai.analyzeDescriptions(aiContext(actor, run.id), { listings: [{ id: "listing", publicDescription: description }], unresolvedCriteria: criteria });
          return analyzed.evidence.map(e => ({ criterion: e.criterion, state: e.result, evidence: e.quote ?? "", source: "ai" as const }));
        } }); } catch {  }
      }
    }
    const availability = ai ? await ai.checkWebSearchAvailability(aiContext(actor, run.id), filters)
      : { budgetAvailable: false, limitAvailable: false };
    const fallback = decideFallback(result.sources, { aiEnabled: settings.aiEnabled && !!ai, webSearchEnabled: settings.config.YANDEX_WEB_SEARCH_ENABLED,
      autoFallback: settings.autoFallback, manualAllowed: settings.manualAllowed, ...availability, alreadyAttempted: false });
    await transaction(async tx => {
      for (const source of result.sources) await tx.searchRunSource.create({ data: { runId: run.id, ...source } });
      for (const item of result.listings) await persistListing(tx, run.id, item.listing, item.evaluation, previousRunId);
      const healthy = result.sources.some(s => s.status === "success" || s.status === "partial");
      const status = healthy ? result.sources.every(s => s.status === "success" || s.status === "disabled") ? "success" : "partial" : "error";
      await tx.searchRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), fallbackReason: fallback.reason } });
      
      
      const comparable = status === "success" || status === "partial" && result.listings.length > 0;
      if (input.savedSearchId) await tx.savedSearch.update({ where: { id: input.savedSearchId }, data: { lastRunAt: run.startedAt, ...(comparable ? { lastSuccessfulRunId: run.id } : {}) } });
      await searchAudit(tx, actor, "run", "SearchRun", run.id, { status, count: result.listings.length });
    });
    if (fallback.automatic && ai) await performWebSearch(actor, run.id, ai, true);
    await regroupRunListings(run.id);
    return getSearchRun(actor, run.id);
  } catch (error) {
    await db.searchRun.update({ where: { id: run.id }, data: { status: "error", finishedAt: new Date(), fallbackReason: "Поиск завершился ошибкой. Сохранённые подборки доступны." } });
    throw error;
  }
}

async function performWebSearch(actor: Actor, runId: string, ai: SearchAiPort, automatic: boolean) {
  const run = await accessibleRun(actor, runId);
  const filters = parseInput(SearchFilters, run.filters);
  
  const claimed = await db.searchRun.updateMany({ where: { id: runId, userId: actor.userId, webSearchUsed: false }, data: { webSearchUsed: true } });
  if (!claimed.count) throw new ConflictError("WEB_SEARCH_ALREADY_USED", "Веб-поиск для этого запуска уже выполнялся");
  try {
    const web = await ai.webSearch({ ...aiContext(actor, runId), automaticWeb: automatic, fullTechnicalFailure: automatic }, filters);
    await transaction(async tx => {
      const persisted = new Set<string>();
      for (const candidate of web.candidates) {
        if (!candidate.originalUrl) continue;
        try { await guardExternalUrl(candidate.originalUrl); } catch { continue; }
        
        const listing: NormalizedListing = { source: "cian", sourceListingId: null, sourceUnitId: null, url: candidate.originalUrl,
          purpose: null, operation: null, price: null, priceUnit: null, area: null, floor: { kind: "unknown", number: null, raw: null },
          city: null, address: null, district: null, seller: { type: "unknown" }, description: candidate.title, images: [],
          fetchedAt: candidate.fetchedAt, structuredFeatures: {}, possibleDuplicateKeys: [], identityNeedsReview: true };
        const evaluation = evaluateListing(listing, filters);
        evaluation.verdict = "needs_review";
        await persistListing(tx, runId, listing, evaluation, null, "web_search", "web_search");
        persisted.add(candidate.originalUrl);
      }
      const rejected = web.candidates.filter(c => c.rejectionReason).map(c => c.rejectionReason);
      const pageChecks = [...new Set(web.candidates.filter(c => c.originalUrl).map(c => c.pageCheck).filter(Boolean))];
      await tx.searchRunSource.create({ data: { runId, source: "web_search", status: "success", resultCount: persisted.size,
        reason: [persisted.size ? "Веб-резерв: первоисточники требуют проверки" : "Веб-поиск выполнен; проверяемых карточек объявлений не найдено",
          ...(rejected.length ? [`Отклонено: ${rejected.length} (${[...new Set(rejected)].join(", ")})`] : []), ...pageChecks].join("; ") } });
      await tx.searchRun.update({ where: { id: runId }, data: { status: "partial", finishedAt: new Date() } });
      await searchAudit(tx, actor, "web_search", "SearchRun", runId, { automatic });
    });
  } catch {
    await db.searchRunSource.upsert({ where: { runId_source: { runId, source: "web_search" } }, create: { runId, source: "web_search", status: "error", reason: "Веб-поиск недоступен или лимит исчерпан. Повторная платная попытка не выполняется." }, update: {} });
  }
}
export async function manualWebSearch(actor: Actor, runId: string) {
  await accessibleRun(actor, runId);
  const settings = await searchSettings();
  const ai = settings.aiEnabled ? await getSearchAi() : null;
  if (!settings.aiEnabled || !settings.manualAllowed || !ai) throw new ConflictError("WEB_SEARCH_DISABLED", "Ручной веб-поиск не разрешён или ИИ недоступен");
  await ai.assertConfigured?.();
  await performWebSearch(actor, runId, ai, false);
  return getSearchRun(actor, runId);
}
export async function parseQuery(actor: Actor, text: unknown, currentFilters: unknown) {
  const input = parseInput(z.object({ text: z.string().trim().min(1).max(4000), currentFilters: SearchFilters }), { text, currentFilters });
  const settings = await searchSettings();
  const ai = settings.aiEnabled ? await getSearchAi() : null;
  if (!ai) throw new ConflictError("AI_DISABLED", "Разбор с ИИ недоступен. Заполните условия в ручной форме.");
  await ai.assertConfigured?.();
  const jobId = randomUUID();
  const startedAt = new Date();
  
  await db.searchRun.create({ data: { id: jobId, userId: actor.userId, city: input.currentFilters.city, filters: jsonValue(input.currentFilters), status: "running", startedAt } });
  try {
    const result = await ai.parseSearchQuery(aiContext(actor, jobId), { query: input.text, currentFilters: input.currentFilters });
    await db.searchRun.update({ where: { id: jobId }, data: { status: "success", finishedAt: new Date() } });
    return result;
  }
  catch (error) {
    await db.searchRun.update({ where: { id: jobId }, data: { status: "error", finishedAt: new Date() } });
    if (error instanceof ConflictError && error.code === "AI_CREDENTIALS_MISSING") throw error;
    const reason = error instanceof ConflictError || error instanceof AiError ? error.code : "UNKNOWN";
    logger.warn({ operation: "property_search.parse", reason }, "Разбор с ИИ недоступен");
    throw new ConflictError("AI_UNAVAILABLE", "Разбор с ИИ недоступен или лимит исчерпан. Ручная форма доступна.");
  }
}

export async function exportSearchCsv(actor: Actor, runId: string) {
  const run = await getSearchRun(actor, runId);
  const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
  const rows: unknown[][] = [["Фильтры", JSON.stringify(run.filters)], ["Источники", run.sources.map(s => `${s.source}: ${s.status}`).join("; ")],
    ["Источник", "URL", "Адрес", "Цена", "Площадь", "Вердикт", "Новое", "Цена изменена"]];
  for (const row of run.results) {
    const snap = row.snapshot as Record<string, unknown> | null;
    rows.push([row.listing.source, snap?.url ?? row.listing.url, snap?.address ?? "", snap?.price ?? "", snap?.area ?? "", row.verdict, row.isNew, row.priceChanged]);
  }
  return "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n");
}
