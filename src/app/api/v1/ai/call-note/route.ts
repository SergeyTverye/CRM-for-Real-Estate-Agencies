import { api, readJson } from "@/server/api-handler";
import { previewCallNote } from "@/modules/ai/application/p2-service";
export const POST = api({}, async ({actor, req}) => previewCallNote(actor, await readJson(req)));
