import { api, json, readJson } from "@/server/api-handler";
import { addCommission } from "@/modules/deals/application/deal-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => json(await addCommission(actor, params.id, await readJson(req)), 201));
