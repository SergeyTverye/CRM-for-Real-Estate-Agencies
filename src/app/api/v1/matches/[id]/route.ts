import { api, readJson } from "@/server/api-handler";
import { updateMatch } from "@/modules/matching/application/matching-service";

export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => {
  await updateMatch(actor, params.id, await readJson(req));
  return { ok: true };
});
