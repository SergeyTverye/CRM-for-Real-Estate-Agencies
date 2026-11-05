import { api, readJson } from "@/server/api-handler";
import { decideAction } from "@/modules/ai-chat/application/chat-service";
export const POST = api<{
    id: string;
    actionId: string;
}>({}, async ({ actor, params, req }) => decideAction(actor, params.id, params.actionId, await readJson(req)));
