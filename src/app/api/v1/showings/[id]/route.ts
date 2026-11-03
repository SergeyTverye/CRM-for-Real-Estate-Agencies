import { api, readJson } from "@/server/api-handler";
import { getShowing, updateShowing } from "@/modules/showings/application/showing-service";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getShowing(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateShowing(actor, params.id, await readJson(req)));
