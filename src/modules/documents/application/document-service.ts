import { z } from "zod";
import type { Readable } from "node:stream";
import { db, transaction, type DbOrTx, type Tx } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { getStorage } from "@/shared/storage/storage-adapter";
import { logger } from "@/shared/logging/logger";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zUuid } from "@/shared/validation";
import type { Code } from "@/shared/codebook";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import {
  advertisementWriteScope,
  agreementScope,
  canEditProperty,
  clientScope,
  dealScope,
  documentScope,
  needScope,
  offerScope,
  showingScope,
} from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { sanitizeFileName, validateUpload } from "../domain/file-policy";
import { PHOTO_MIMES, preparePropertyImage } from "../domain/property-image";

/**
 * UC-08 UploadOrDownloadDocument (FR-14, ТЗ 20.4, 29.8, 40.8).
 * Файл хранится через StorageAdapter, в БД — метаданные и связь через join-таблицы.
 * Выдача — только после проверки доступа к связанной сущности; storage key/путь наружу не выдаётся.
 * Для исходящих документов из Deal/Agreement/CommercialOffer legal_entity_id наследуется.
 */

export const LINK_KINDS = ["client", "need", "property", "showing", "deal", "advertisement", "agreement", "offer"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface DocumentLink {
  kind: LinkKind;
  id: string;
}

const OUTGOING_TYPES = new Set(["agreement", "commercial_offer", "act", "invoice"]);

/** Право загрузить документ к сущности (запись), возвращает наследуемый legal_entity_id. */
async function assertCanAttach(tx: DbOrTx, actor: Actor, link: DocumentLink): Promise<{ legalEntityId: string | null }> {
  const fail = () => {
    throw new NotFoundError("Связанная запись не найдена или недоступна");
  };
  switch (link.kind) {
    case "client":
      if (!(await tx.client.count({ where: { id: link.id, ...clientScope(actor) } }))) fail();
      return { legalEntityId: null };
    case "need":
      if (!(await tx.clientNeed.count({ where: { id: link.id, ...needScope(actor) } }))) fail();
      return { legalEntityId: null };
    case "property": {
      const p = await tx.property.findUnique({ where: { id: link.id }, select: { responsibleUserId: true } });
      if (!p) fail();
      if (!canEditProperty(actor, p!)) throw new ForbiddenError("Документы объекта добавляет ответственный риелтор или руководитель");
      return { legalEntityId: null };
    }
    case "showing":
      if (!(await tx.showing.count({ where: { id: link.id, ...showingScope(actor) } }))) fail();
      return { legalEntityId: null };
    case "deal": {
      const d = await tx.deal.findFirst({ where: { id: link.id, ...dealScope(actor) }, select: { legalEntityId: true } });
      if (!d) fail();
      return { legalEntityId: d!.legalEntityId };
    }
    case "advertisement":
      if (!(await tx.advertisement.count({ where: { id: link.id, ...advertisementWriteScope(actor) } }))) fail();
      return { legalEntityId: null };
    case "agreement": {
      const a = await tx.agreement.findFirst({ where: { id: link.id, ...agreementScope(actor) }, select: { legalEntityId: true } });
      if (!a) fail();
      return { legalEntityId: a!.legalEntityId };
    }
    case "offer": {
      const o = await tx.commercialOffer.findFirst({ where: { id: link.id, ...offerScope(actor) }, select: { legalEntityId: true } });
      if (!o) fail();
      return { legalEntityId: o!.legalEntityId };
    }
  }
}

async function insertLink(tx: Tx, documentId: string, link: DocumentLink, documentTypeCode?: string) {
  switch (link.kind) {
    case "client":
      return tx.documentClient.create({ data: { documentId, clientId: link.id } });
    case "need":
      return tx.documentNeed.create({ data: { documentId, clientNeedId: link.id } });
    case "property":
      return tx.documentProperty.create({ data: { documentId, propertyId: link.id, kind: documentTypeCode === "photo" ? "photo" : "document" } });
    case "showing":
      return tx.documentShowing.create({ data: { documentId, showingId: link.id } });
    case "deal":
      return tx.documentDeal.create({ data: { documentId, dealId: link.id } });
    case "advertisement":
      return tx.documentAdvertisement.create({ data: { documentId, advertisementId: link.id } });
    case "agreement":
      return tx.documentAgreement.create({ data: { documentId, agreementId: link.id } });
    case "offer":
      return tx.documentCommercialOffer.create({ data: { documentId, commercialOfferId: link.id } });
  }
}

const uploadMetaSchema = z.object({
  documentTypeCode: zCode("documentType"),
  linkKind: z.enum(LINK_KINDS),
  linkId: zUuid,
  legalEntityId: zUuid.optional(),
});

export interface StoreDocumentInput {
  data: Buffer;
  originalName: string;
  mimeType: string;
  documentTypeCode: Code<"documentType">;
  link: DocumentLink;
  legalEntityId: string | null;
}

/**
 * Сохранение бинарного файла и метаданных. При ошибке БД файл удаляется (без бесхозных файлов).
 * Права на связанную сущность проверяются вызывающей командой.
 */
export async function storeDocument(actorUserId: string, input: StoreDocumentInput, auditAction = "document.uploaded"): Promise<{ id: string }> {
  const storage = getStorage();
  const image = input.documentTypeCode === "photo" || (input.link.kind === "property" && PHOTO_MIMES.has(input.mimeType))
    ? await preparePropertyImage(input.data, input.mimeType) : null;
  const stored = await storage.put(image?.data ?? input.data);
  let thumbnailStorageKey: string | undefined;
  try {
    if (image) thumbnailStorageKey = (await storage.put(image.thumbnail, { prefix: "thumbnails" })).storageKey;
    return await transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          originalName: input.originalName,
          documentTypeCode: input.documentTypeCode,
          mimeType: input.mimeType,
          fileSize: BigInt(stored.size),
          storageProvider: storage.provider,
          storageKey: stored.storageKey,
          thumbnailStorageKey,
          checksum: stored.sha256,
          uploadedBy: actorUserId,
          legalEntityId: input.legalEntityId,
        },
        select: { id: true },
      });
      await insertLink(tx, doc.id, input.link, input.documentTypeCode);
      if (input.legalEntityId || input.link.kind === "deal" || input.link.kind === "agreement") {
        await writeAudit(tx, {
          actorUserId,
          action: auditAction,
          entityType: "Document",
          entityId: doc.id,
          after: { documentTypeCode: input.documentTypeCode, link: input.link, legalEntityId: input.legalEntityId, size: stored.size },
        });
      }
      return doc;
    });
  } catch (e) {
    await storage.remove(stored.storageKey).catch((err) => logger.error({ err }, "orphan file cleanup failed"));
    if (thumbnailStorageKey) await storage.remove(thumbnailStorageKey).catch(() => logger.error("thumbnail cleanup failed"));
    throw e;
  }
}

/** Загрузка пользователем (multipart). */
export async function uploadDocument(actor: Actor, file: File | null, rawMeta: unknown): Promise<{ id: string }> {
  const meta = parseInput(uploadMetaSchema, rawMeta);
  if (!file || typeof file === "string") throw new ValidationError("Выберите файл", { file: ["Файл не передан"] });
  const cfg = getConfig();
  if (file.size > cfg.maxUploadBytes) throw new ValidationError(undefined, { file: [`Файл больше ${cfg.MAX_UPLOAD_MB} МБ`] });
  const data = Buffer.from(await file.arrayBuffer());
  const originalName = sanitizeFileName(file.name || "file");
  const check = validateUpload(originalName, data, cfg.uploadAllowedExtensions, cfg.maxUploadBytes);
  if ("error" in check) throw new ValidationError(check.error, { file: [check.error] });
  const link = { kind: meta.linkKind, id: meta.linkId };
  const inherited = await assertCanAttach(db, actor, link);
  let legalEntityId: string | null = meta.legalEntityId ?? null;
  if (!legalEntityId && OUTGOING_TYPES.has(meta.documentTypeCode)) legalEntityId = inherited.legalEntityId;
  if (legalEntityId && !(await db.legalEntity.count({ where: { id: legalEntityId } }))) throw new ValidationError(undefined, { legalEntityId: ["Юрлицо не найдено"] });
  return storeDocument(actor.userId, { data, originalName, mimeType: check.mime, documentTypeCode: meta.documentTypeCode, link, legalEntityId });
}

/** Сгенерированный документ (КП и т.п.) — после проверки прав вызывающей командой. */
export async function attachGeneratedDocument(actor: Actor, input: Omit<StoreDocumentInput, "legalEntityId"> & { legalEntityId?: string | null }): Promise<{ id: string }> {
  const inherited = await assertCanAttach(db, actor, input.link);
  return storeDocument(actor.userId, { ...input, legalEntityId: input.legalEntityId ?? inherited.legalEntityId }, "document.generated");
}

/** Выдача файла: сначала доступ к бизнес-сущности, затем поток. Знание id/storage key прав не даёт. */
export async function openDocumentForDownload(actor: Actor, documentId: string): Promise<{ stream: Readable; size: number; mimeType: string; fileName: string }> {
  const doc = await db.document.findFirst({ where: { id: documentId, ...documentScope(actor) } });
  if (!doc) throw new NotFoundError();
  const { stream, size } = await getStorage().read(doc.storageKey);
  return { stream, size, mimeType: doc.mimeType, fileName: doc.originalName };
}

export async function archiveDocument(actor: Actor, documentId: string): Promise<void> {
  await transaction(async (tx) => {
    const doc = await tx.document.findFirst({ where: { id: documentId, ...documentScope(actor) } });
    if (!doc) throw new NotFoundError();
    if (!isManager(actor) && doc.uploadedBy !== actor.userId) throw new ForbiddenError("Архивировать документ может автор или руководитель");
    if (doc.archivedAt) return;
    await tx.document.update({ where: { id: documentId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "document.archived", entityType: "Document", entityId: documentId, before: { archivedAt: null } });
  });
}

const LINK_WHERE: Record<LinkKind, (id: string) => object> = {
  client: (id) => ({ clientLinks: { some: { clientId: id } } }),
  need: (id) => ({ needLinks: { some: { clientNeedId: id } } }),
  property: (id) => ({ propertyLinks: { some: { propertyId: id } } }),
  showing: (id) => ({ showingLinks: { some: { showingId: id } } }),
  deal: (id) => ({ dealLinks: { some: { dealId: id } } }),
  advertisement: (id) => ({ advertisementLinks: { some: { advertisementId: id } } }),
  agreement: (id) => ({ agreementLinks: { some: { agreementId: id } } }),
  offer: (id) => ({ offerLinks: { some: { commercialOfferId: id } } }),
};

/** Документы карточки, видимые пользователю. */
export async function listDocumentsFor(actor: Actor, link: DocumentLink, opts: { includeArchived?: boolean } = {}) {
  const docs = await db.document.findMany({
    where: { AND: [LINK_WHERE[link.kind](link.id), documentScope(actor), opts.includeArchived ? {} : { archivedAt: null }] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      documentTypeCode: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
      archivedAt: true,
      uploadedBy: true,
      uploader: { select: { displayName: true } },
      legalEntity: { select: { displayName: true } },
    },
  });
  // Сколько документов скрыто правом доступа (без раскрытия сведений), — только для объекта.
  return docs.map((d) => ({ ...d, fileSize: Number(d.fileSize), canArchive: isManager(actor) || d.uploadedBy === actor.userId }));
}
