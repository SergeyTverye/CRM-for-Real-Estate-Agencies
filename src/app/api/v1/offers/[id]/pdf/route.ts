import { api } from "@/server/api-handler";
import { generateOfferPdf } from "@/modules/commercial-offers/application/offer-pdf";
import { offerPrintOrigin } from "@/modules/commercial-offers/application/offer-print-origin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => {
  const data = await generateOfferPdf(actor, params.id, offerPrintOrigin(req));
  return new Response(new Uint8Array(data), { headers: {
    "content-type": "application/pdf", "content-disposition": `attachment; filename="offer-${params.id}.pdf"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  } });
});
