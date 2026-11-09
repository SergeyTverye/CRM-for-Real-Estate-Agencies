import type { Actor } from "@/modules/auth/domain/actor";
import { attachGeneratedDocument } from "@/modules/documents/application/document-service";
import { DomainError } from "@/shared/errors";
import { getOfferPrintData } from "./offer-print-data";
import { offerDocx } from "@/modules/export/presentation/offer-docx";

export async function generateOfferDocument(actor: Actor, offerId: string, baseUrl = ""): Promise<{ id: string }> {
  const data = await getOfferPrintData(actor, offerId, baseUrl);
  if (data.status === "archived") throw new DomainError("OFFER_ARCHIVED", "Предложение в архиве");
  const buffer = await offerDocx(data);
  const safeTitle = data.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60).trim() || "КП";
  return attachGeneratedDocument(actor, { data: Buffer.from(buffer), originalName: `${safeTitle}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", documentTypeCode: "commercial_offer",
    link: { kind: "offer", id: data.id }, legalEntityId: data.legalEntityId });
}
