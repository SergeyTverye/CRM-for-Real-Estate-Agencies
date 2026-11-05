import { api, readJson } from "@/server/api-handler";
import { confirmCallNote } from "@/modules/ai/application/p2-service";
export const POST = api({}, async ({actor, req}) => confirmCallNote(actor, await readJson(req)));
