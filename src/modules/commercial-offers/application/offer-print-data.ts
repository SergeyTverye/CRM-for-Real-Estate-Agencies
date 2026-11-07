import { db } from "@/shared/db/client";
import { displayLabel } from "@/shared/codebook";
import { DICTIONARY_SEED } from "@/modules/dictionaries/domain/dictionary-data";
import sharp from "sharp";
import type { Actor } from "@/modules/auth/domain/actor";
import { getPrintIssuer, getPropertySourceUrl } from "@/modules/export/application/print-data";
import { documentImage } from "@/modules/export/application/document-image";
import { listPropertyMedia } from "@/modules/properties/application/property-media-service";
import { getConfig } from "@/shared/config/env";
import { formatDate } from "@/shared/time";
import { getOffer } from "./offer-service";

const num = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const missing = "Не указано";
export type PrintImage = { dataUrl: string; width: number; height: number; caption: string };

async function image(actor: Actor, id: string, caption: string): Promise<PrintImage> {
  const data = await documentImage(actor, id);
  const meta = await sharp(data).metadata();
  return { dataUrl: `data:image/png;base64,${data.toString("base64")}`, width: meta.width!, height: meta.height!, caption };
}

/** Saved values win. Only missing legacy purpose may fall back to the catalogue. */
export function offerCharacteristics(item: { addressSnapshot: string | null; areaSnapshot: { toString(): string } | null; priceSnapshot: { toString(): string } | null; termsSnapshot: string | null }, fallbackPurpose?: string | null) {
  const terms = item.termsSnapshot ?? "";
  const field = (label: string) => terms.split("\n").find(line => line.startsWith(`${label}: `))?.slice(label.length + 2);
  const unit = field("Единица цены");
  // Older snapshots contain the operation but have no structured unit. Do not invent one.
  const priceUnit = unit ?? (/^продажа(?:,|$)/.test(terms) ? "₽" : "₽ (единица не зафиксирована)");
  const price = item.priceSnapshot === null ? "По запросу" : `${num.format(Number(item.priceSnapshot.toString()))} ${priceUnit}`;
  const area = item.areaSnapshot === null ? missing : `${num.format(Number(item.areaSnapshot.toString()))} м²`;
  const canDivide = priceUnit === "₽" || priceUnit === "₽/мес.";
  const perM2 = item.priceSnapshot !== null && item.areaSnapshot !== null && Number(item.areaSnapshot.toString()) > 0 && canDivide
    ? `${num.format(Number(item.priceSnapshot.toString()) / Number(item.areaSnapshot.toString()))} ${priceUnit === "₽/мес." ? "₽/м²/мес." : "₽/м²"}` : "Не определена";
  const purpose = field("Назначение")?.trim() || fallbackPurpose || missing;
  return { address: item.addressSnapshot ?? missing, district: field("Район") ?? missing, purpose: DICTIONARY_SEED.property_type.find(([code]) => code === purpose)?.[1] ?? displayLabel("property_type", purpose),
    floor: field("Этаж") ?? terms.match(/этаж\s+(-?\d+(?:\/\d+)?)/)?.[1] ?? missing, area, price, perM2 };
}

export async function getOfferPrintData(actor: Actor, offerId: string, baseUrl = "") {
  // getOffer applies offerScope before any image, issuer or property lookups.
  const { offer } = await getOffer(actor, offerId);
  const issuer = await getPrintIssuer(actor, offer.legalEntityId);
  const logo = issuer?.logoDocumentId ? await image(actor, issuer.logoDocumentId, "Логотип") : null;
  const items = [];
  // Sequential bounded image decoding: at most four catalogue photos per property, no external fetch.
  for (const item of offer.items) {
    const photos = (await listPropertyMedia(actor, item.propertyId)).filter(m => m.kind === "photo")
      .sort((a, b) => Number(b.isCover) - Number(a.isCover)).slice(0, 4);
    const images: PrintImage[] = [];
    for (const photo of photos) images.push(await image(actor, photo.id, photo.caption ?? "Фото объекта"));
    const property = await db.property.findUniqueOrThrow({ where: { id: item.propertyId }, select: { propertyType: true, commercialPurpose: true } });
    const purpose = property.commercialPurpose ? await db.dictionaryItem.findUnique({ where: { category_code: { category: "commercial_purpose", code: property.commercialPurpose } }, select: { displayName: true } }) : null;
    const propertyType = purpose ? null : await db.dictionaryItem.findUnique({ where: { category_code: { category: "property_type", code: property.propertyType } }, select: { displayName: true } });
    items.push({ id: item.id, position: item.position, ...offerCharacteristics(item, purpose?.displayName ?? propertyType?.displayName ?? property.propertyType), terms: item.termsSnapshot,
      comment: item.comment, images, sourceUrl: await getPropertySourceUrl(item.propertyId), propertyUrl: `${baseUrl}/properties/${item.propertyId}` });
  }
  const zone = getConfig().APP_TIMEZONE;
  return { id: offer.id, status: offer.status, legalEntityId: offer.legalEntityId, title: offer.title ?? "Коммерческое предложение",
    date: formatDate(offer.sentAt ?? offer.createdAt, zone), expires: offer.expiresAt ? formatDate(offer.expiresAt.toISOString().slice(0, 10), zone) : null,
    intro: offer.introText ?? "Предлагаем рассмотреть следующие объекты недвижимости. Характеристики и стоимость приведены на дату формирования предложения.",
    responsible: offer.responsible.displayName, issuer, logo, items };
}
export type OfferPrintData = Awaited<ReturnType<typeof getOfferPrintData>>;
