import type { Actor } from "@/modules/auth/domain/actor";
import { getOfferPrintData } from "./offer-print-data";
import { offerHtml } from "@/modules/export/presentation/offer-html";
import { htmlToPdf } from "@/modules/export/application/html-pdf";

export async function generateOfferPdf(actor: Actor, id: string, baseUrl = "") {
  const data = await getOfferPrintData(actor, id, baseUrl);
  return htmlToPdf(offerHtml(data));
}
