import { api } from "@/server/api-handler";
import { querySearchResults } from "@/modules/property-search/queries/results-query";
import { ValidationError } from "@/shared/errors";
export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => {
  const { freshness, unknownDates, ...query } = Object.fromEntries(req.nextUrl.searchParams);
  let parsed: unknown;
  try { parsed = freshness ? JSON.parse(freshness) : undefined; } catch { throw new ValidationError("Некорректный фильтр свежести"); }
  return querySearchResults(actor, params.id, { ...query, ...(freshness ? { freshness: parsed } : {}), ...(unknownDates ? { unknownDates: unknownDates === "true" } : {}) });
});
