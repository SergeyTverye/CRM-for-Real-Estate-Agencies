import { api, readJson } from "@/server/api-handler";
import { confirmOfferText } from "@/modules/ai/application/p2-service";
export const POST = api({}, async ({actor, req}) => confirmOfferText(actor, await readJson(req)));
