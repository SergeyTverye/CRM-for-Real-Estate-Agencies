import { api, readJson } from "@/server/api-handler";
import { sendMessage } from "@/modules/ai-chat/application/chat-service";
export const maxDuration = 240;
export const POST = api<{
    id: string;
}>({}, async ({ actor, params, req }) => sendMessage(actor, params.id, await readJson(req)));
