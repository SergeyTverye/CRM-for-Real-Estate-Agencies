import { api, readJson } from "@/server/api-handler";
import { getOffer, updateOffer } from "@/modules/commercial-offers/application/offer-service";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getOffer(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateOffer(actor, params.id, await readJson(req)));
