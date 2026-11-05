import { getPrintIssuer, getPropertySourceUrl } from "@/modules/export/application/print-data";
import { documentImage } from "@/modules/export/application/document-image";
import { listPropertyMedia } from "@/modules/properties/application/property-media-service";
import { AlignmentType, ExternalHyperlink, ImageRun, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { getConfig } from "@/shared/config/env";
import { formatDate } from "@/shared/time";
import type { Actor } from "@/modules/auth/domain/actor";
import { attachGeneratedDocument } from "@/modules/documents/application/document-service";
import { DomainError } from "@/shared/errors";
import { getOffer } from "./offer-service";

/**
 * Итоговый редактируемый документ КП (DOCX) из структурированной записи CommercialOffer (FR-39, T10).
 * Содержимое строится только из snapshot-полей позиций, а не из текущих карточек Property.
 * Document наследует legal_entity_id предложения и связывается через document_commercial_offers.
 * Контакты собственников в документ не включаются.
 */
function money(v: { toString(): string } | null): string {
  if (v === null) return "по запросу";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(v.toString()))} ₽`;
}

function cell(text: string, bold = false) {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
}

export async function generateOfferDocument(actor: Actor, offerId: string, baseUrl = ""): Promise<{ id: string }> {
  const { offer } = await getOffer(actor, offerId);
  if (offer.status === "archived") throw new DomainError("OFFER_ARCHIVED", "Предложение в архиве");
  const tz = getConfig().APP_TIMEZONE;
  const issuer = offer.legalEntity ? `${offer.legalEntity.displayName}` : "Агентство недвижимости";
  const printIssuer = await getPrintIssuer(actor, offer.legalEntityId);
  const logo = printIssuer?.logoDocumentId ? await documentImage(actor, printIssuer.logoDocumentId) : null;
  const mediaParagraphs: Paragraph[] = [];
  for (const item of offer.items) {
    const photos = (await listPropertyMedia(actor, item.propertyId)).filter(m => m.kind === "photo").slice(0, 5);
    mediaParagraphs.push(new Paragraph({ children: [new ExternalHyperlink({ link: `${baseUrl}/properties/${item.propertyId}`, children: [new TextRun({ text: item.addressSnapshot ?? "Карточка объекта", style: "Hyperlink" })] })] }));
    const sourceUrl = await getPropertySourceUrl(item.propertyId);
    if (sourceUrl) mediaParagraphs.push(new Paragraph({ children: [new ExternalHyperlink({ link: sourceUrl, children: [new TextRun({ text: "Источник объявления", style: "Hyperlink" })] })] }));
    for (const photo of photos) {
      const data = await documentImage(actor, photo.id);
      mediaParagraphs.push(new Paragraph({ children: [new ImageRun({ type: "png", data, transformation: { width: 360, height: 240 } })] }));
      if (photo.caption) mediaParagraphs.push(new Paragraph(photo.caption));
    }
  }
  const doc = new Document({
    creator: issuer,
    title: offer.title ?? "Коммерческое предложение",
    sections: [
      {
        children: [
          ...(logo ? [new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 120, height: 80 } })] })] : []),
          ...(printIssuer?.requisites ? [new Paragraph(printIssuer.requisites)] : []),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: issuer, bold: true })] }),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`Дата: ${formatDate(offer.sentAt ?? offer.updatedAt, tz)}`)] }),
          new Paragraph({ text: offer.title ?? "Коммерческое предложение", heading: HeadingLevel.HEADING_1 }),
          ...(offer.introText ? offer.introText.split(/\n+/).map((p) => new Paragraph({ text: p })) : []),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: [cell("№", true), cell("Объект", true), cell("Площадь, м²", true), cell("Стоимость", true), cell("Условия", true)] }),
              ...offer.items.map(
                (i) =>
                  new TableRow({
                    children: [
                      cell(String(i.position)),
                      cell(i.addressSnapshot ?? ""),
                      cell(i.areaSnapshot ? i.areaSnapshot.toString() : "—"),
                      cell(money(i.priceSnapshot)),
                      cell([i.termsSnapshot, i.comment].filter(Boolean).join(". ")),
                    ],
                  }),
              ),
            ],
          }),
          new Paragraph({ text: "" }),
          ...mediaParagraphs,
          ...(offer.expiresAt ? [new Paragraph({ text: `Предложение действительно до ${formatDate(offer.expiresAt.toISOString().slice(0, 10), tz)}.` })] : []),
          new Paragraph({ children: [new TextRun({ text: `Ответственный сотрудник: ${offer.responsible.displayName}`, italics: true })] }),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  const safeTitle = (offer.title ?? "КП").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60).trim() || "КП";
  return attachGeneratedDocument(actor, {
    data: Buffer.from(buffer),
    originalName: `${safeTitle}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    documentTypeCode: "commercial_offer",
    link: { kind: "offer", id: offer.id },
    legalEntityId: offer.legalEntityId,
  });
}
