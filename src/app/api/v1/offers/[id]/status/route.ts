import { api, readJson } from "@/server/api-handler";
import { changeOfferStatus } from "@/modules/commercial-offers/application/offer-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => changeOfferStatus(actor, params.id, await readJson(req)));
