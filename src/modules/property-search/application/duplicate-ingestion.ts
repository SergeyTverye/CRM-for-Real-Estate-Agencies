import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { regroupForListings, getGroupsForListings, type DuplicateGroupDto } from "@/modules/listing-duplicates";

/** Called after commit. Grouping failure must never discard an accepted listing. */
export async function regroupRunListings(runId: string) {
  const results = await db.searchRunResult.findMany({ where: { runId }, select: { listingId: true }, orderBy: { listingId: "asc" } });
  let failed = false;
  for (let start = 0; start < results.length; start += 500) {
    try { await regroupForListings(results.slice(start, start + 500).map(r => r.listingId)); }
    catch { failed = true; break; }
  }
  const run = await db.searchRun.findUniqueOrThrow({ where: { id: runId }, select: { progress: true } });
  const progress = run.progress && typeof run.progress === "object" && !Array.isArray(run.progress) ? run.progress : {};
  await db.searchRun.update({ where: { id: runId }, data: { progress: { ...progress, duplicateGrouping: failed ? "failed" : "completed", duplicateGroupingError: failed ? "Не удалось сгруппировать дубли. Сохранённые объявления доступны." : null } } });
}

export async function groupsForExport(actor: Actor, listingIds: string[]) {
  const groups = new Map<string, DuplicateGroupDto>();
  for (let start = 0; start < listingIds.length; start += 500)
    for (const group of await getGroupsForListings(actor, listingIds.slice(start, start + 500))) groups.set(group.id, group);
  return [...groups.values()];
}
