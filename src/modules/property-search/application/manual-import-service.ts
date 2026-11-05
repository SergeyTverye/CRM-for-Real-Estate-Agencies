import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import { parseInput } from "@/shared/validation";
import { ValidationError } from "@/shared/errors";
import { guardExternalUrl } from "@/shared/net/ssrf";
import type { Actor } from "@/modules/auth/domain/actor";
import { SearchFilters, SOURCES, type NormalizedListing, type SearchResult } from "../domain/types";
import { addListingByUrl, manualListing, manualListingSchema, listingSourceUrl } from "../infrastructure/manual-listing";
import { importOfficialFeed } from "../infrastructure/official-feed";
import { evaluateListing } from "../domain/evaluation";
import { trustedListing } from "./search-queue";
import { jsonValue, persistListing, searchAudit } from "./search-service";
import { regroupRunListings } from "./duplicate-ingestion";
const linkInput = z.object({ url: z.string().max(2000), filters: SearchFilters, manual: manualListingSchema.omit({ url: true }).optional() }).strict();
async function saveManualCandidates(actor: Actor, filters: SearchFilters, listings: NormalizedListing[], incomplete: boolean) {
  const items: SearchResult["listings"] = [];
  for (const raw of listings) {
    const listing = await trustedListing(raw);
    items.push({ listing, evaluation: evaluateListing(listing, filters) });
  }
  const saved = await transaction(async tx => {
    const now = new Date();
    const run = await tx.searchRun.create({ data: { userId: actor.userId, filters: jsonValue(filters), city: filters.city, status: "completed", startedAt: now, finishedAt: now, incompleteReason: incomplete ? "Ручной импорт: выборка неполная" : null } });
    for (const item of items) await persistListing(tx, run.id, item.listing, item.evaluation, null, "manual");
    for (const source of new Set(listings.map(l => l.source))) await tx.searchRunSource.create({ data: { runId: run.id, source, status: "completed", receivedCount: listings.filter(l => l.source === source).length, acceptedCount: items.filter(i => i.listing.source === source && i.evaluation.verdict !== "rejected").length, resultCount: listings.filter(l => l.source === source).length, statusReasonRu: "Добавлено сотрудником из ссылки или официальной выгрузки" } });
    await searchAudit(tx, actor, "manual_import", "SearchRun", run.id, { count: items.length });
    return { runId: run.id, importedCount: items.length };
  });
  await regroupRunListings(saved.runId);
  return saved;
}
export async function createListingFromUrl(actor: Actor, raw: unknown, signal?: AbortSignal) {
  const input = parseInput(linkInput, raw);
  let identity: ReturnType<typeof listingSourceUrl>;
  try { identity = listingSourceUrl(input.url); await guardExternalUrl(identity.url); }
  catch { throw new ValidationError("Разрешена HTTPS-ссылка объявления поддерживаемой площадки"); }
  if (input.manual) {
    const listing = manualListing({ ...input.manual, url: identity.url });
    return { status: "success", ...await saveManualCandidates(actor, input.filters, [listing], true) };
  }
  const result = await addListingByUrl(identity.url, { signal });
  if (result.status !== "success") return result;
  if (signal?.aborted) throw new ValidationError("Добавление отменено");
  return { status: "success", ...await saveManualCandidates(actor, input.filters, [result.listing], true) };
}
const feedInput = z.object({ source: z.enum(SOURCES), format: z.enum(["csv", "xlsx", "xml"]), filters: SearchFilters, commit: z.boolean().default(false) }).strict();
export async function importSearchFeed(actor: Actor, file: File, raw: unknown) {
  const input = parseInput(feedInput, raw);
  if (!file || file.size <= 0 || file.size > 10000000) throw new ValidationError("Выберите выгрузку размером до 10 МБ");
  let result: Awaited<ReturnType<typeof importOfficialFeed>>;
  try { result = await importOfficialFeed(Buffer.from(await file.arrayBuffer()), { source: input.source, format: input.format, maxRows: 1000 }); }
  catch { throw new ValidationError("Не удалось прочитать безопасную официальную выгрузку"); }
  const accepted: NormalizedListing[] = [];
  for (const listing of result.listings) {
    try { await guardExternalUrl(listingSourceUrl(listing.url).url); accepted.push(listing); }
    catch { result.errors.push({ row: 0, code: "INVALID_FEED_ROW" }); }
  }
  // Preview is inert; neither pending rows without public URLs nor rejected network URLs are stored.
  const preview = accepted.map(l => ({ listing: l, evaluation: evaluateListing(l, input.filters) }));
  const saved = input.commit ? await saveManualCandidates(actor, input.filters, accepted, true) : {};
  if (input.commit) await searchAudit(db, actor, "feed_imported", "SearchRun", (saved as { runId: string }).runId, { rowsRead: result.rowsRead, count: accepted.length });
  return { ...saved, committed: input.commit, rowsRead: result.rowsRead, incomplete: result.incomplete, errors: result.errors, pending: result.pending, preview };
}
