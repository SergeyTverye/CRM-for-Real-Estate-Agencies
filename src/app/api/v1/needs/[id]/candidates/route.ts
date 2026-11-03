import { api } from "@/server/api-handler";
import { findCandidates } from "@/modules/matching/application/matching-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api<{ id: string }>({}, async ({ req, actor, params }) => {
  const r = await findCandidates(actor, params.id, searchParamsToObject(req.nextUrl.searchParams));
  return { criteria: r.criteria, items: r.items };
});
