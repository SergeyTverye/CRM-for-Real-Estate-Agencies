import { api, readJson } from "@/server/api-handler";
import { previewOfferText } from "@/modules/ai/application/p2-service";
export const POST = api({}, async ({actor, req}) => previewOfferText(actor, await readJson(req)));
