import { z } from "zod";
import { Readable } from "node:stream";
import { db, transaction, type Tx } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { getStorage } from "@/shared/storage/storage-adapter";
import { logger } from "@/shared/logging/logger";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, zCode } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { documentScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { MIME_BY_EXTENSION, sanitizeFileName, validateUpload } from "@/modules/documents/domain/file-policy";
import { PHOTO_MIMES, preparePropertyImage } from "@/modules/documents/domain/property-image";
import { loadEditableProperty } from "./property-service";

const uploadSchema = z.object({ kind: zCode("propertyMediaKind"), documentTypeCode: zCode("documentType").optional() });
const changeSchema = z.object({
  caption: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isCover: z.boolean().optional(),
  archived: z.boolean().optional(),
  move: z.enum(["up", "down"]).optional(),
});

async function lockProperty(tx: Tx, actor: Actor, propertyId: string) {
  assertRecordId(propertyId);
  await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
  return loadEditableProperty(tx, actor, propertyId);
}

export async function listPropertyMedia(actor: Actor, propertyId: string, includeArchived = false) {
  assertRecordId(propertyId);
  if (!await db.property.count({ where: { id: propertyId } })) throw new NotFoundError();
  const rows = await db.documentProperty.findMany({
    where: { propertyId, ...(includeArchived ? {} : { archivedAt: null }), document: { AND: [documentScope(actor), ...(includeArchived ? [] : [{ archivedAt: null }])] } },
    orderBy: [{ sortOrder: "asc" }, { documentId: "asc" }],
    select: { kind: true, caption: true, sortOrder: true, isCover: true, archivedAt: true,
      document: { select: { id: true, originalName: true, mimeType: true, documentTypeCode: true, fileSize: true, archivedAt: true } } },
  });
  return rows.map(({ document: d, ...link }) => ({
    id: d.id, name: d.originalName, mimeType: d.mimeType, size: Number(d.fileSize),
    kind: d.documentTypeCode === "photo" && PHOTO_MIMES.has(d.mimeType) ? "photo" as const : "document" as const,
    caption: link.caption, sortOrder: link.sortOrder, isCover: link.isCover && !link.archivedAt && !d.archivedAt,
    archived: Boolean(link.archivedAt || d.archivedAt),
    url: `/api/v1/properties/${propertyId}/media/${d.id}/file`,
    thumbnailUrl: `/api/v1/properties/${propertyId}/media/${d.id}/thumbnail`,
  }));
}
export type PropertyMediaItem = Awaited<ReturnType<typeof listPropertyMedia>>[number];

/** Each request is one file: a failed queue item cannot roll back successful uploads. */
export async function uploadPropertyMedia(actor: Actor, propertyId: string, file: File | null, input: unknown) {
  const meta = parseInput(uploadSchema, input);
  await loadEditableProperty(db, actor, propertyId);
  if (!file) throw new ValidationError("Выберите файл");
  const cfg = getConfig();
  if (file.size > cfg.maxUploadBytes) throw new ValidationError(`Файл больше ${cfg.MAX_UPLOAD_MB} МБ`);
  const originalName = sanitizeFileName(file.name);
  let data = Buffer.from(await file.arrayBuffer());
  const check = validateUpload(originalName, data, cfg.uploadAllowedExtensions, cfg.maxUploadBytes);
  if ("error" in check) throw new ValidationError(check.error);
  if (file.type && file.type !== "application/octet-stream" && !MIME_BY_EXTENSION[check.ext]?.includes(file.type)) throw new ValidationError("MIME файла не соответствует содержимому");
  if (meta.kind === "document" && meta.documentTypeCode === "photo") throw new ValidationError("Выберите раздел фотографий");
  let thumbnail: Buffer | undefined;
  // Also strip metadata from closed image scans; their type remains a protected document.
  if (PHOTO_MIMES.has(check.mime)) {
    const prepared = await preparePropertyImage(data, check.mime);
    data = Buffer.from(prepared.data);
    thumbnail = prepared.thumbnail;
  } else if (meta.kind === "photo") throw new ValidationError("Фотографии: только JPEG, PNG или WebP");
  const storage = getStorage();
  const keys: string[] = [];
  try {
    const stored = await storage.put(data);
    keys.push(stored.storageKey);
    const thumb = thumbnail ? await storage.put(thumbnail, { prefix: "thumbnails" }) : null;
    if (thumb) keys.push(thumb.storageKey);
    let reused = false;
    const result = await transaction(async (tx) => {
      await lockProperty(tx, actor, propertyId);
      // Retrying after a lost response returns the already linked upload.
      const existing = await tx.document.findFirst({ where: {
        checksum: stored.sha256, originalName, archivedAt: null,
        documentTypeCode: meta.kind === "photo" ? "photo" : meta.documentTypeCode ?? "other",
        propertyLinks: { some: { propertyId, kind: meta.kind, archivedAt: null } },
      }, select: { id: true } });
      if (existing) { reused = true; return existing; }
      const last = await tx.documentProperty.aggregate({ where: { propertyId }, _max: { sortOrder: true } });
      const cover = meta.kind === "photo" && !await tx.documentProperty.count({ where: { propertyId, isCover: true, archivedAt: null, document: { archivedAt: null } } });
      const d = await tx.document.create({ data: {
        originalName, mimeType: check.mime, documentTypeCode: meta.kind === "photo" ? "photo" : meta.documentTypeCode ?? "other",
        fileSize: BigInt(stored.size), checksum: stored.sha256, storageProvider: storage.provider, storageKey: stored.storageKey,
        thumbnailStorageKey: thumb?.storageKey, uploadedBy: actor.userId,
        propertyLinks: { create: { propertyId, kind: meta.kind, sortOrder: (last._max.sortOrder ?? -1) + 1, isCover: cover } },
      }, select: { id: true } });
      await writeAudit(tx, { actorUserId: actor.userId, action: "property.media_uploaded", entityType: "Property", entityId: propertyId, after: { documentId: d.id, kind: meta.kind } });
      return d;
    });
    if (reused) await Promise.all(keys.map((key) => storage.remove(key).catch(() => logger.error("duplicate upload cleanup failed"))));
    return result;
  } catch (error) {
    await Promise.all(keys.map((key) => storage.remove(key).catch(() => logger.error("media cleanup failed"))));
    throw error;
  }
}

export async function updatePropertyMedia(actor: Actor, propertyId: string, documentId: string, input: unknown) {
  assertRecordId(documentId);
  const change = parseInput(changeSchema, input);
  await transaction(async (tx) => {
    await lockProperty(tx, actor, propertyId);
    const link = await tx.documentProperty.findFirst({ where: { propertyId, documentId, document: documentScope(actor) }, include: { document: true } });
    if (!link) throw new NotFoundError();
    if (change.archived === false && link.document.archivedAt) {
      if (!isManager(actor) && link.document.uploadedBy !== actor.userId) throw new ForbiddenError("Восстановить документ может автор или руководитель");
      await tx.document.update({ where: { id: documentId }, data: { archivedAt: null } });
    }
    if (change.move) {
      const photo = link.document.documentTypeCode === "photo";
      const ordered = await tx.documentProperty.findMany({ where: { propertyId, archivedAt: link.archivedAt ? { not: null } : null, document: { AND: [documentScope(actor), { documentTypeCode: photo ? "photo" : { not: "photo" } }] } }, orderBy: [{ sortOrder: "asc" }, { documentId: "asc" }], select: { documentId: true } });
      const from = ordered.findIndex((row) => row.documentId === documentId);
      const to = from + (change.move === "up" ? -1 : 1);
      if (from >= 0 && to >= 0 && to < ordered.length) {
        const moved = ordered.splice(from, 1)[0]!;
        ordered.splice(to, 0, moved);
        for (const [sortOrder, row] of ordered.entries()) await tx.documentProperty.update({ where: { documentId_propertyId: { documentId: row.documentId, propertyId } }, data: { sortOrder } });
      }
    }
    if (change.isCover && (link.document.documentTypeCode !== "photo" || !PHOTO_MIMES.has(link.document.mimeType) || change.archived === true || (link.archivedAt && change.archived !== false) || (link.document.archivedAt && change.archived !== false))) throw new ValidationError("Главным может быть только активное фото");
    if (change.isCover) await tx.documentProperty.updateMany({ where: { propertyId, isCover: true }, data: { isCover: false } });
    await tx.documentProperty.update({ where: { documentId_propertyId: { documentId, propertyId } }, data: {
      caption: change.caption, sortOrder: change.sortOrder,
      kind: link.document.documentTypeCode === "photo" ? "photo" : "document",
      isCover: change.archived ? false : change.isCover,
      archivedAt: change.archived === undefined ? undefined : change.archived ? new Date() : null,
    } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "property.media_changed", entityType: "Property", entityId: propertyId, after: { documentId, ...change } });
  });
  return { ok: true };
}

export async function openPropertyMedia(actor: Actor, propertyId: string, documentId: string, thumbnail = false) {
  assertRecordId(propertyId); assertRecordId(documentId);
  const link = await db.documentProperty.findFirst({ where: { propertyId, documentId, document: documentScope(actor) }, include: { document: true } });
  if (!link) throw new NotFoundError();
  const d = link.document;
  // Legacy photos are decoded safely and stripped on read without mutating a standby instance.
  if (d.documentTypeCode === "photo" && PHOTO_MIMES.has(d.mimeType) && !d.thumbnailStorageKey) {
    const source = await getStorage().read(d.storageKey);
    if (source.size > getConfig().maxUploadBytes) { source.stream.destroy(); throw new ValidationError("Файл превышает допустимый размер"); }
    const chunks: Buffer[] = [];
    for await (const chunk of source.stream) chunks.push(Buffer.from(chunk));
    const image = await preparePropertyImage(Buffer.concat(chunks), d.mimeType);
    const data = thumbnail ? image.thumbnail : image.data;
    return { stream: Readable.from(data), size: data.length, mimeType: thumbnail ? "image/webp" : d.mimeType, fileName: d.originalName, inline: true };
  }
  const useThumbnail = thumbnail && Boolean(d.thumbnailStorageKey);
  const result = await getStorage().read(useThumbnail ? d.thumbnailStorageKey! : d.storageKey);
  return { ...result, mimeType: useThumbnail ? "image/webp" : d.mimeType, fileName: d.originalName, inline: PHOTO_MIMES.has(d.mimeType) && d.documentTypeCode === "photo" };
}

/** Batch selection avoids N+1 catalogue queries and never emits storage references. */
export async function propertyCoverUrls(actor: Actor, propertyIds: string[]) {
  const rows = await db.documentProperty.findMany({ where: { propertyId: { in: propertyIds }, archivedAt: null, document: { AND: [documentScope(actor), { archivedAt: null, documentTypeCode: "photo", mimeType: { in: [...PHOTO_MIMES] } }] } }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { documentId: "asc" }], select: { propertyId: true, documentId: true } });
  const urls: Record<string, string> = {};
  for (const row of rows) urls[row.propertyId] ??= `/api/v1/properties/${row.propertyId}/media/${row.documentId}/thumbnail`;
  return urls;
}
