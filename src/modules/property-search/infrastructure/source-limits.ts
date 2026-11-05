import type { Source } from "../domain/types";

export const SOURCE_LIMITS: Record<Source, { maxPages: number; limit: number; requestsPerPage: number; setupRequests: number }> = {
  cian: { maxPages: 3, limit: 150, requestsPerPage: 1, setupRequests: 0 },
  avito: { maxPages: 2, limit: 100, requestsPerPage: 2, setupRequests: 1 },
  domclick: { maxPages: 3, limit: 150, requestsPerPage: 1, setupRequests: 0 },
  yandex: { maxPages: 5, limit: 200, requestsPerPage: 1, setupRequests: 0 },
  mirkvartir: { maxPages: 2, limit: 100, requestsPerPage: 1, setupRequests: 0 },
  onrealt: { maxPages: 5, limit: 200, requestsPerPage: 1, setupRequests: 0 },
  youla: { maxPages: 3, limit: 150, requestsPerPage: 1, setupRequests: 1 },
};
export interface DepthOptions { maxPages?: number; limit?: number; }
function bounded(value: unknown, fallback: number, ceiling: number): number {
  if (value === undefined) return Math.min(fallback, ceiling);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("INVALID_SCRAPER_LIMIT");
  return Math.min(n, ceiling);
}
export function resolveSourceDepth(source: Source, options: DepthOptions = {}, branches = 1) {
  const safe = SOURCE_LIMITS[source], prefix = `SCRAPER_${source.toUpperCase()}_`;
  const pagesCeiling = bounded(process.env[`${prefix}MAX_PAGES`], safe.maxPages, safe.maxPages);
  const limitCeiling = bounded(process.env[`${prefix}MAX_LISTINGS`], safe.limit, safe.limit);
  const maxPages = bounded(options.maxPages, 2, pagesCeiling), limit = bounded(options.limit, 100, limitCeiling);
  return { maxPages, limit, estimatedRequests: maxPages * Math.max(1, branches) * safe.requestsPerPage + safe.setupRequests, dateSortSupported: false };
}
