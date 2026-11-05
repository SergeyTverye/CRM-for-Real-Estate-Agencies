import { api, readJson } from "@/server/api-handler";
import { listChats, createChat } from "@/modules/ai-chat/application/chat-service";
export const GET = api({}, async ({ actor }) => listChats(actor));
export const POST = api({}, async ({ actor, req }) => createChat(actor, await readJson(req)));
