import { api, readJson } from "@/server/api-handler";
import { updateNeedParams } from "@/modules/needs/application/need-service";
import { getNeedCard } from "@/modules/needs/application/need-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getNeedCard(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateNeedParams(actor, params.id, await readJson(req)));
