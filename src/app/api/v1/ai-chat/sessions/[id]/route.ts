import { api } from "@/server/api-handler";
import { getChat } from "@/modules/ai-chat/application/chat-service";
export const GET = api<{
    id: string;
}>({}, async ({ actor, params }) => getChat(actor, params.id));
