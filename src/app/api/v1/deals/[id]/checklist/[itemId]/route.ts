import { api, readJson } from "@/server/api-handler";
import { updateChecklistItem } from "@/modules/deals/application/checklist-service";
export const PATCH = api<{ id: string; itemId: string }>({}, async ({ actor, params, req }) => updateChecklistItem(actor, params.id, params.itemId, await readJson(req)));
