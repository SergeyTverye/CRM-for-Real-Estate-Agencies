import { api, readJson } from "@/server/api-handler";
import { saveChecklistItem } from "@/modules/tasks/application/checklist-service";
export const PATCH = api<{ id: string; itemId: string }>({}, async ({ actor, req, params }) => saveChecklistItem(actor, params.id, await readJson(req), params.itemId));
