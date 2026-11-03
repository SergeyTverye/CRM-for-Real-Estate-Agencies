import { api, readJson } from "@/server/api-handler";
import { updateCommission } from "@/modules/deals/application/deal-service";

export const PATCH = api<{ id: string; commissionId: string }>({}, async ({ req, actor, params }) => updateCommission(actor, params.id, params.commissionId, await readJson(req)));
