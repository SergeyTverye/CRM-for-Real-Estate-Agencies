import { api, json } from "@/server/api-handler";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";
import { offerPrintOrigin } from "@/modules/commercial-offers/application/offer-print-origin";

export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => json(await generateOfferDocument(actor, params.id, offerPrintOrigin(req)), 201));
