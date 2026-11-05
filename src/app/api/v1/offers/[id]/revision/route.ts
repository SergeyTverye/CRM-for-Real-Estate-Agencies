import { api, readJson } from "@/server/api-handler";
import { createOfferRevision } from "@/modules/commercial-offers/application/offer-service";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => createOfferRevision(actor, params.id, await readJson(req)));
