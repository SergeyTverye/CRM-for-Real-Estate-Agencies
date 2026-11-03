import { api, json, readJson } from "@/server/api-handler";
import { createOffer, listOffers } from "@/modules/commercial-offers/application/offer-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listOffers(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createOffer(actor, await readJson(req)), 201));
