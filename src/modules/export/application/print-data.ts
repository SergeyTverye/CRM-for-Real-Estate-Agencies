import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { documentScope } from "@/modules/access/domain/scopes";
import { NotFoundError } from "@/shared/errors";
import { assertRecordId } from "@/shared/validation";
import { listPropertyMedia } from "@/modules/properties/application/property-media-service";
export async function getPrintIssuer(actor: Actor, id?: string | null) {
  if (!id) return null;
  assertRecordId(id);
  const issuer = await db.legalEntity.findUnique({ where: { id }, select: { displayName: true, requisites: true, logoDocumentId: true } });
  if (!issuer) throw new NotFoundError();
  const logo = issuer.logoDocumentId ? await db.document.findFirst({ where: { AND: [documentScope(actor), { id: issuer.logoDocumentId, archivedAt: null, mimeType: { in: ["image/png", "image/jpeg", "image/webp"] } }] }, select: { id: true } }) : null;
  return { displayName: issuer.displayName, requisites: issuer.requisites, logoDocumentId: logo?.id ?? null };
}
export async function getPropertyPrint(actor: Actor, id: string, legalEntityId?: string) {
  assertRecordId(id);
  const property = await db.property.findUnique({ where: { id }, select: { id: true, addressText: true, operationType: true, propertyType: true, area: true, price: true, floor: true, floorsTotal: true, description: true, sourceUrl: true } });
  if (!property) throw new NotFoundError();
  const issuerId = legalEntityId ?? (await db.legalEntity.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  const [issuer, media] = await Promise.all([getPrintIssuer(actor, issuerId), listPropertyMedia(actor, id)]);
  return { property, issuer, photos: media.filter(m => m.kind === "photo") };
}
export function publicHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}

export async function getPropertySourceUrl(id: string) {
  assertRecordId(id);
  const property = await db.property.findUnique({ where: { id }, select: { sourceUrl: true } });
  if (!property) throw new NotFoundError();
  return publicHttpUrl(property.sourceUrl);
}
