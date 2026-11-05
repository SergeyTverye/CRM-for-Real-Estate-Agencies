import { api, json } from "@/server/api-handler";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";

export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => json(await generateOfferDocument(actor, params.id, req.nextUrl.origin), 201));
