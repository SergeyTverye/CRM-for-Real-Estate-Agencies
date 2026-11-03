import { api, readJson } from "@/server/api-handler";
import { closeDeal } from "@/modules/deals/application/deal-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => closeDeal(actor, params.id, await readJson(req)));
