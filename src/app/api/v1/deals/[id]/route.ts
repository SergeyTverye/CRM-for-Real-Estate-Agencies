import { api, readJson } from "@/server/api-handler";
import { getDeal, updateDeal } from "@/modules/deals/application/deal-service";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getDeal(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateDeal(actor, params.id, await readJson(req)));
