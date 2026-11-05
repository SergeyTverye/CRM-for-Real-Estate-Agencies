import { api } from "@/server/api-handler";
import { getChecklist, initializeChecklist } from "@/modules/deals/application/checklist-service";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => getChecklist(actor, params.id));
export const POST = api<{ id: string }>({}, async ({ actor, params }) => initializeChecklist(actor, params.id));
