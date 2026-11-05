import { api, json, readJson } from "@/server/api-handler";
import { listChecklist, saveChecklistItem } from "@/modules/tasks/application/checklist-service";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => listChecklist(actor, params.id));
export const POST = api<{ id: string }>({}, async ({ actor, req, params }) => json(await saveChecklistItem(actor, params.id, await readJson(req)), 201));
