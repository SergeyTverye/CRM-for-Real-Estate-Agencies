import { db, demoId, marker, type DemoContext } from "./context";
import { Prisma } from "@/shared/db/client";
import { runSearch } from "@/modules/property-search/application/search-service";
import { saveSearch, setBookmark, setSelection, transferToCatalog, proposeListing } from "@/modules/property-search/application/listing-service";
import { SearchFilters } from "@/modules/property-search/domain/types";

export async function seedSearchAndCosts(ctx: DemoContext) {
  const actor = ctx.agents[0]!, needId = ctx.needs[0]!.id;
  const setting = await db.aiSetting.findFirstOrThrow();
  await db.aiSetting.update({ where: { id: setting.id }, data: { aiEnabled: true, scraperEnabled: true, enabledSources: ["cian", "mirkvartir", "avito"], webSearchManualAllowed: true, webSearchAutoFallback: true } });
  const filters = SearchFilters.parse({ city: "Новосибирск", operation: "sale", sources: ["cian", "mirkvartir"], purposes: ["retail"], floorMode: "exclude_basement_and_semi_basement" });
  const saved = [];
  for (const name of [`${marker} Торговые помещения — записанные ответы`, `${marker} Веб-резерв — демонстрация отказа`]) {
    saved.push(await db.savedSearch.findFirst({ where: { ownerUserId: actor.userId, name } }) ?? await saveSearch(actor, { name, filters, sources: filters.sources, needId }));
  }
  const runs = [];
  for (const scenario of ["success", "partial", "failure"] as const) {
    const savedSearchId = saved[scenario === "failure" ? 1 : 0]!.id;
    const label = `${marker} DEMO recorded scenario=${scenario}`;
    const sourceWhere = scenario === "success" ? { none: { status: { not: "success" } }, some: { status: "success" } } : scenario === "partial" ? { some: { status: "blocked" } } : { none: { source: { not: "web_search" }, status: "success" }, some: { status: "blocked" } };
    let run = await db.searchRun.findFirst({ where: { savedSearchId, userId: actor.userId, OR: [{ fallbackReason: label }, { sources: sourceWhere }] }, orderBy: { startedAt: "asc" } });
    if (!run) {
      const created = await runSearch(actor, { filters, sources: filters.sources, savedSearchId, needId, confirmedPaid: true, demoScenario: scenario });
      run = await db.searchRun.findUniqueOrThrow({ where: { id: created.id } });
    }
    if (scenario === "failure" && !await db.searchRunSource.count({ where: { runId: run.id, source: "web_search", status: "success" } })) throw new Error("Demo web fallback failed; check demo AI limits/tariffs");
    if (run.fallbackReason !== label) await db.searchRun.update({ where: { id: run.id }, data: { fallbackReason: label } });
    for (const source of await db.searchRunSource.findMany({ where: { runId: run.id } })) {
      if (!source.reason?.includes(marker)) await db.searchRunSource.update({ where: { id: source.id }, data: { reason: `${marker} ДЕМО / записанный ответ. ${source.reason ?? ""}` } });
    }
    for (const log of await db.aiUsageLog.findMany({ where: { searchRunId: run.id } })) {
      const result = log.result && typeof log.result === "object" && !Array.isArray(log.result) ? log.result : {};
      if (result.demo !== true) await db.aiUsageLog.update({ where: { id: log.id }, data: { result: { ...result, demo: true, mode: "test", note: "Демонстрация FakeResponsesProvider. Реальных расходов нет." } as Prisma.InputJsonValue } });
    }
    runs.push(run);
  }
  const listings = await db.searchRunResult.findMany({ where: { runId: runs[0]!.id }, orderBy: { listingId: "asc" }, take: 3 });
  if (!listings.length) throw new Error("Demo fixture search has no listings");
  for (const [i, row] of listings.entries()) {
    if (!await db.searchBookmark.count({ where: { userId: actor.userId, listingId: row.listingId } })) await setBookmark(actor, row.listingId, { status: i ? "clarify" : "study", note: `${marker} Записанный синтетический результат` });
    if (!await db.searchSelection.count({ where: { needId, listingId: row.listingId } })) await setSelection(actor, row.listingId, { needId, reviewStatus: i ? "candidate" : "shortlisted", comment: `${marker} Демонстрационная подборка` });
  }
  const listingId = listings[0]!.listingId;
  const listing = await db.externalListing.findUniqueOrThrow({ where: { id: listingId } });
  if (!listing.propertyId) await transferToCatalog(actor, listingId, { confirmed: true, identityConfirmed: true });
  const transferred = await db.externalListing.findUniqueOrThrow({ where: { id: listingId }, include: { property: true } });
  if (transferred.property && !transferred.property.description?.includes(marker)) await db.property.update({
    where: { id: transferred.property.id }, data: { description: `${marker} Синтетический объект из записанного поиска. ${transferred.property.description ?? ""}` },
  });
  if (!await db.searchSelection.count({ where: { needId, listingId, matchId: { not: null } } })) await proposeListing(actor, listingId, { needId, comment: `${marker} Факт предложения синтетического объекта` });

  const localize = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("Москва", "Новосибирск").replaceAll("Тверской", "Центральный").replaceAll("Примерная", "Демонстрационная")) as Prisma.InputJsonValue;
  for (const row of saved) await db.savedSearch.update({ where: { id: row!.id }, data: { city: "Новосибирск", filters: localize(row!.filters) } });
  for (const row of runs) await db.searchRun.update({ where: { id: row.id }, data: { city: "Новосибирск", filters: localize(row.filters) } });
  const demoListings = await db.externalListing.findMany({ where: { runResults: { some: { runId: { in: runs.map(r => r.id) } } }, sourceListingId: { startsWith: "synthetic-" } }, include: { snapshots: true } });
  for (const row of demoListings) {
    const address = row.address?.replaceAll("Москва", "Новосибирск").replaceAll("Тверской", "Центральный").replaceAll("Примерная", "Демонстрационная");
    await db.externalListing.update({ where: { id: row.id }, data: { city: "Новосибирск", district: row.district?.replaceAll("Тверской", "Центральный"), address } });
    for (const snap of row.snapshots) await db.externalListingSnapshot.update({ where: { id: snap.id }, data: { normalized: localize(snap.normalized) } });
    if (row.propertyId) await db.property.updateMany({ where: { id: row.propertyId, description: { contains: marker } }, data: { addressText: address ?? undefined, district: "Центральный" } });
  }
  const model = setting.model;
  const tariffs = await db.aiTariff.findMany({ where: { model, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
  const price = (unit: string) => {
    const tariff = tariffs.find(t => t.unit === unit);
    if (!tariff) throw new Error("Ordinary seed AI tariffs required");
    return tariff.priceRub;
  };
  for (let i = 0; i < 6; i++) {
    const callType = ["parse", "description", "web_search"][i % 3]!, inputTokens = 1100 + i * 200, outputTokens = 180 + i * 30, webSearchCalls = callType === "web_search" ? 1 : 0;
    const cost = (input: number, output: number) => price("input_million_tokens").mul(input).div(1000000).add(price("output_million_tokens").mul(output).div(1000000)).add(webSearchCalls ? price("web_search_call") : new Prisma.Decimal(0));
    await db.aiUsageLog.upsert({ where: { id: demoId(`usage:${i}`) }, update: {}, create: { id: demoId(`usage:${i}`), callType, userId: ctx.agents[i % 2]!.userId, searchRunId: runs[i % 3]!.id, model,
      inputTokens, outputTokens, webSearchCalls, estimatedCostRub: cost(inputTokens + 500, outputTokens + 200).toFixed(2), actualCostRub: cost(inputTokens, outputTokens).toFixed(2), status: "success", durationMs: 120 + i * 40,
      result: { demo: true, mode: "test", note: `${marker} Синтетическая оценка и условный факт по тарифам seed. Реальных расходов нет.`, tariffIds: tariffs.map(t => t.id) },
    } });
  }
}
