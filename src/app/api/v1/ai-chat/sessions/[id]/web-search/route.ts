import { api, readJson } from "@/server/api-handler";
import { confirmedWebSearch } from "@/modules/ai-chat/application/chat-service";
export const POST = api<{
    id: string;
}>({}, async ({ actor, params, req }) => confirmedWebSearch(actor, params.id, await readJson(req)));
