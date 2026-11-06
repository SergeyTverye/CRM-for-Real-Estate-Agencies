import { requirePostgresSql } from "@/shared/db/dialect";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, Prisma } from "@/shared/db/client";
import { parseInput } from "@/shared/validation";
import { ConflictError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { accessibleRun } from "../application/search-service";
import { freshnessSchema, freshnessBounds } from "../domain/freshness";
import { getGroupsForListings } from "@/modules/listing-duplicates";
import { clientScope, needScope } from "@/modules/access/domain/scopes";
import { collectionScope } from "@/modules/collections/application/collection-service";

export const SORTS = ["publication", "first_seen", "source_updated", "price", "price_per_m2", "area", "match", "last_checked", "price_change"] as const;
export const resultQuerySchema = z.object({
  sort: z.enum(SORTS).default("match"), direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
  verdict: z.enum(["confirmed", "needs_review", "rejected"]).optional(), source: z.string().max(30).optional(),
  freshness: freshnessSchema.optional(), unknownDates: z.boolean().default(false),
  priceUnit: z.string().max(30).optional(), revision: z.string().max(64).optional(),
}).strict();
export type ResultQuery = z.input<typeof resultQuerySchema>;
const fields = { publication: "s.published_at", first_seen: "l.first_seen_at", source_updated: "s.source_updated_at", price: "s.price_rub", price_per_m2: "s.price_per_m2_rub", area: "s.area_m2", match: "CASE r.verdict WHEN 'confirmed' THEN 2 WHEN 'needs_review' THEN 1 ELSE 0 END", last_checked: "l.last_checked_at", price_change: "r.price_changed" } as const;
export function resultOrder(sort: typeof SORTS[number], direction: "asc" | "desc") {
  // Units precede amounts: currencies/periods are never presented as comparable numbers.
  const unit = sort === "price" ? "s.normalized->>'priceUnit' ASC NULLS LAST," : sort === "price_per_m2" ? "s.price_per_m2_unit ASC NULLS LAST," : "";
  return `${unit} ${fields[sort]} ${direction.toUpperCase()} NULLS LAST, ${sort === "match" ? `r.score ${direction.toUpperCase()} NULLS LAST,` : ""} r.id ASC`;
}
export async function querySearchResults(actor: Actor, runId: string, raw: unknown = {}, exportIds?: string[], exportBatch = false) {
  await accessibleRun(actor, runId);
  return db.$transaction(async tx => {
  const run = await tx.searchRun.findUniqueOrThrow({ where: { id: runId } });
  // Internal export batches avoid recomputing the full selection digest per 200 rows.
  // HTTP callers always retain the public 200-row limit; this flag is never parsed from input.
  const schema = exportBatch ? resultQuerySchema.extend({ pageSize: z.coerce.number().int().min(1).max(2000).default(2000) }) : resultQuerySchema;
  const q = parseInput(schema, { ...(run.sortParams as Record<string, unknown>), ...(raw as Record<string, unknown>) });
  const base = Prisma.sql`FROM search_run_results r JOIN external_listings l ON l.id=r.listing_id
    LEFT JOIN LATERAL (SELECT * FROM external_listing_snapshots s0 WHERE s0.search_run_id=r.run_id AND s0.listing_id=r.listing_id ORDER BY s0.fetched_at DESC,s0.id ASC LIMIT 1) s ON true`;
  const conditions = [Prisma.sql`r.run_id=${runId}::uuid`];
  if (q.source) conditions.push(Prisma.sql`l.source=${q.source}`);
  if (q.priceUnit) conditions.push(q.sort === "price_per_m2" ? Prisma.sql`s.price_per_m2_unit=${q.priceUnit}` : Prisma.sql`s.normalized->>'priceUnit'=${q.priceUnit}`);
  if (exportIds) conditions.push(Prisma.sql`r.listing_id IN (${Prisma.join(exportIds.map(id => Prisma.sql`${id}::uuid`))})`);
  const freshness = q.freshness ?? (run.filters as Record<string, unknown>).freshness;
  const unknownDateCount = await tx.$queryRaw<{ count: bigint }[]>(requirePostgresSql(Prisma.sql`SELECT COUNT(*) AS count ${base} WHERE ${Prisma.join(conditions, " AND ")} AND s.published_at IS NULL`));
  if (freshness) {
    // Freeze the relative window at job creation, so pages/exports use the same interval.
    const f = parseInput(freshnessSchema, freshness), bounds = freshnessBounds(f, run.startedAt);
    const field = Prisma.raw(f.mode === "published" ? "s.published_at" : "l.first_seen_at");
    const interval = f.period === "24h" ? Prisma.sql`${field} >= ${bounds.from} AND ${field} <= ${bounds.to}` : Prisma.sql`${field} >= ${bounds.from} AND ${field} < ${bounds.to}`;
    conditions.push(q.unknownDates ? Prisma.sql`${field} IS NULL` : interval);
  } else if (q.unknownDates) conditions.push(Prisma.sql`s.published_at IS NULL`);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const counts = await tx.$queryRaw<{ verdict: string; count: bigint }[]>(requirePostgresSql(Prisma.sql`SELECT r.verdict,COUNT(*) AS count ${base} ${where} GROUP BY r.verdict`));
  // Every row contributes: max(timestamp) alone misses changes below the maximum.
  const state = await tx.$queryRaw<{ digest: string }[]>(requirePostgresSql(Prisma.sql`SELECT md5(COALESCE(string_agg(concat_ws('|',r.id,r.verdict,r.score,r.criteria::text,r.is_new,r.price_changed,s.id,l.last_checked_at),',' ORDER BY r.id),'')) AS digest ${base} WHERE r.run_id=${runId}::uuid`));
  const { page: _page, revision: _revision, ...selection } = q;
  void _page; void _revision;
  const revision = createHash("sha256").update(JSON.stringify([run.status, run.finishedAt, state, selection])).digest("hex");
  if (q.revision && q.revision !== revision || q.page > 1 && !q.revision) throw new ConflictError("SEARCH_RESULTS_CHANGED", "Выдача изменилась. Обновите первую страницу.");
  if (q.verdict) conditions.push(Prisma.sql`r.verdict=${q.verdict}`);
  const filtered = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const total = counts.filter(c => !q.verdict || c.verdict === q.verdict).reduce((n, c) => n + Number(c.count), 0);
  const rows = await tx.$queryRaw<Record<string, unknown>[]>(requirePostgresSql(Prisma.sql`SELECT r.id,r.listing_id AS "listingId",r.verdict,r.criteria,r.score,r.is_new AS "isNew",r.price_changed AS "priceChanged",
    s.normalized AS snapshot,l.source,l.url,l.first_seen_at AS "firstSeenAt",l.last_checked_at AS "lastCheckedAt",
    s.published_at AS "publishedAt",s.date_precision AS "datePrecision",s.date_source AS "dateSource",s.price_per_m2_rub AS "pricePerM2Rub",s.price_per_m2_unit AS "pricePerM2Unit"
    ${base} ${filtered} ORDER BY ${Prisma.raw(resultOrder(q.sort, q.direction))} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`));
  const sources = await tx.searchRunSource.findMany({ where: { runId } });
  // Only enrich this page. Never expose another employee's private marks or need facts.
  const accessibleNeed = { AND: [needScope(actor), { client: clientScope(actor) }] };
  const metadata = exportBatch ? [] : await tx.externalListing.findMany({
    where: { id: { in: rows.map(row => String(row.listingId)) } },
    select: {
      id: true, propertyId: true,
      bookmarks: { where: { userId: actor.userId }, select: { note: true, status: true } },
      selections: { where: { need: accessibleNeed }, select: { reviewStatus: true, matchId: true } },
      collectionItems: { where: { collection: { ...collectionScope(actor), archivedAt: null } }, select: { collectionId: true } },
      property: { select: { matches: { where: { need: accessibleNeed }, select: { id: true }, take: 1 } } },
    },
  });
  const facts = new Map(metadata.map(row => [row.id, {
    propertyId: row.propertyId,
    bookmark: row.bookmarks.length > 0, note: row.bookmarks[0]?.note ?? null,
    collectionIds: row.collectionItems.map(item => item.collectionId),
    inCollection: row.collectionItems.length > 0 || row.selections.length > 0,
    proposed: !!row.property?.matches.length || row.selections.some(item => item.matchId !== null),
  }]));
  // Export fetches private notes and duplicate links once after collecting its selection.
  const duplicateGroups = exportBatch ? [] : await getGroupsForListings(actor, rows.map(row => String(row.listingId)));
  return { rows: rows.map(row => Object.assign({}, row, facts.get(String(row.listingId)))), total, page: q.page, pageSize: q.pageSize, revision,
    duplicateGroups, duplicateGroupingError: (run.progress as Record<string, unknown>)?.duplicateGroupingError ?? null,
    counts: { confirmed: 0, needs_review: 0, rejected: 0, ...Object.fromEntries(counts.map(c => [c.verdict, Number(c.count)])) },
    unknownDates: q.unknownDates, unknownDateCount: Number(unknownDateCount[0]?.count ?? 0), sortScope: "saved_selection" as const,
    incomplete: !!run.incompleteReason || ["queued", "running", "partial", "needs_user_action"].includes(run.status), incompleteReason: run.incompleteReason,
    sources: sources.map(s => ({ ...s, browserSessionAction: s.needsUserAction ? { method: "POST", url: "/api/v1/browser-sessions", body: { searchRunId: runId, source: s.source } } : null })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
