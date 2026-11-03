import { api, readJson } from "@/server/api-handler";
import { resolveRequest } from "@/modules/requests/application/request-service";
import { getRequestCard } from "@/modules/requests/application/request-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getRequestCard(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => {
  await resolveRequest(actor, params.id, await readJson(req));
  return { ok: true };
});
