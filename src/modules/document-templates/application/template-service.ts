import { lockSql } from "@/shared/db/dialect";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { db, transaction, type Tx } from "@/shared/db/client";
import { getStorage } from "@/shared/storage/storage-adapter";
import { ForbiddenError, NotFoundError, StaleUpdateError } from "@/shared/errors";
import { parseInput, zUuid, zExpectedUpdatedAt } from "@/shared/validation";
import { FORMATS, KINDS, LIMITS, parseManifest, fail } from "../domain/manifest";
import { MIME, renderDocument } from "../domain/renderers";
import { readPackage } from "../domain/package";
import { buildContext, projectContext, syntheticContext } from "./context";

const manager = (actor: Actor) => { if (actor.role !== "manager") throw new ForbiddenError(); };
const meta = z.object({ code: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/), name: z.string().trim().min(1).max(200), description: z.string().max(2000).optional(), format: z.enum(FORMATS), manifestYaml: z.string().min(1).max(50000), markdownBody: z.string().max(LIMITS.text).optional(), compatibilityNote: z.string().max(2000).optional() }).strict();
export async function listTemplates(actor: Actor, kind?: string, management = false) {
  if (management) manager(actor);
  if (kind && !KINDS.includes(kind as typeof KINDS[number])) fail("Неизвестный тип записи");
  const rows = await db.documentTemplate.findMany({ where: management ? {} : { status: "active" }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 200, include: { currentVersion: { select: { version: true, manifestYaml: true, compatibilityNote: true } } } });
  return rows.filter(r => {
    if (!r.currentVersion) return management && !kind;
    const m = parseManifest(r.currentVersion.manifestYaml);
    return (!kind || m.entityKind === kind) && (management || m.fields.every(f => f.roles.includes(actor.role)));
  }).map(r => ({ id: r.id, versionId: r.currentVersionId, code: r.code, name: r.name, format: r.format, status: r.status, description: r.description, updatedAt: r.updatedAt.toISOString(), version: r.currentVersion?.version, ...(management ? { manifestYaml: r.currentVersion?.manifestYaml, compatibilityNote: r.currentVersion?.compatibilityNote } : {}) }));
}
export async function getTemplate(actor: Actor, id: string) {
  manager(actor); parseInput(zUuid, id);
  const row = await db.documentTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, manifestYaml: true, markdownBody: true, createdAt: true, compatibilityNote: true } } } });
  if (!row) throw new NotFoundError();
  return row;
}
export async function saveTemplate(actor: Actor, raw: unknown, file: File | null, templateId?: string, expectedUpdatedAt?: string) {
  manager(actor);
  const input = parseInput(meta, raw), m = parseManifest(input.manifestYaml);
  if (input.format === "markdown_docx" && !input.markdownBody?.trim()) fail("Введите содержимое Markdown");
  if (templateId) { parseInput(zUuid, templateId); parseInput(zExpectedUpdatedAt, expectedUpdatedAt); }
  let data: Buffer | null = null;
  if (["docx", "xlsx"].includes(input.format)) {
    if (!file || file.size > LIMITS.input || !file.name.toLowerCase().endsWith(`.${input.format}`)) fail("Выберите DOCX/XLSX без макросов размером до 5 МБ");
    data = Buffer.from(await file.arrayBuffer()); readPackage(data);
  } else if (file) fail("Этот режим не принимает бинарный файл");
  await renderDocument(input.format, input.markdownBody ?? null, data, [projectContext(syntheticContext(), m, "manager")], m, "manager");
  const storage = getStorage(), stored = data ? await storage.put(data, { prefix: "templates" }) : null;
  try {
    return await transaction(async tx => {
      const id = templateId ?? randomUUID();
      let version = 1;
      if (templateId) {
        await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM document_templates WHERE id = ${id}::uuid FOR UPDATE`));
        const current = await tx.documentTemplate.findUnique({ where: { id } });
        if (!current) throw new NotFoundError();
        if (current.updatedAt.toISOString() !== expectedUpdatedAt) throw new StaleUpdateError();
        if (current.status === "archived") fail("Архивный шаблон нельзя изменять");
        if (current.format !== input.format || current.code !== input.code) fail("Код и формат версий неизменяемы");
        version = (await tx.documentTemplateVersion.aggregate({ where: { templateId: id }, _max: { version: true } }))._max.version! + 1;
      } else await tx.documentTemplate.create({ data: { id, code: input.code, name: input.name, format: input.format, description: input.description, allowedSources: m.sources } });
      const v = await tx.documentTemplateVersion.create({ data: { templateId: id, version, manifestYaml: input.manifestYaml, markdownBody: input.markdownBody, storageKey: stored?.storageKey, checksum: createHash("sha256").update(input.manifestYaml).update(data ?? input.markdownBody ?? "").digest("hex"), createdBy: actor.userId, compatibilityNote: input.compatibilityNote } });
      const result = await tx.documentTemplate.update({ where: { id }, data: { currentVersionId: v.id, name: input.name, description: input.description, allowedSources: m.sources, updatedAt: new Date() }, select: { id: true, updatedAt: true } });
      await writeAudit(tx, { actorUserId: actor.userId, action: "template.version_created", entityType: "DocumentTemplate", entityId: id, after: { version, format: input.format } });
      return result;
    });
  } catch (e) { if (stored) await storage.remove(stored.storageKey); throw e; }
}
export async function changeTemplateStatus(actor: Actor, id: string, raw: unknown) {
  manager(actor); parseInput(zUuid, id);
  const d = parseInput(z.object({ status: z.enum(["active", "disabled", "archived"]), expectedUpdatedAt: zExpectedUpdatedAt }).strict(), raw);
  return transaction(async tx => {
    const count = await tx.documentTemplate.updateMany({ where: { id, updatedAt: d.expectedUpdatedAt }, data: { status: d.status } });
    if (!count.count) throw new StaleUpdateError();
    await writeAudit(tx, { actorUserId: actor.userId, action: "template.status_changed", entityType: "DocumentTemplate", entityId: id, after: { status: d.status } });
    return { id };
  });
}
async function loadVersion(id: string, versionId?: string, active = true) {
  const row = await db.documentTemplate.findFirst({ where: { id, ...(active ? { status: "active" } : {}) }, include: { currentVersion: true } });
  if (!row) throw new NotFoundError();
  const v = versionId ? await db.documentTemplateVersion.findFirst({ where: { id: versionId, templateId: id } }) : row.currentVersion;
  if (!v) throw new NotFoundError();
  let data: Buffer | null = null;
  if (v.storageKey) { const { stream } = await getStorage().read(v.storageKey); const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); data = Buffer.concat(chunks); }
  return { row, v, data, m: parseManifest(v.manifestYaml) };
}
export async function previewTemplate(actor: Actor, id: string, versionId?: string) {
  manager(actor); parseInput(zUuid, id); if (versionId) parseInput(zUuid, versionId);
  const { row, v, data, m } = await loadVersion(id, versionId, false);
  return renderDocument(row.format, v.markdownBody, data, [projectContext(syntheticContext(), m, actor.role)], m, actor.role);
}
const generation = z.object({ entityKind: z.enum(KINDS), entityId: zUuid, selectedIds: z.array(zUuid).min(1).max(LIMITS.records).optional(), versionId: zUuid.optional(), requestId: zUuid.optional() }).strict();
async function linkDocument(tx: Tx, documentId: string, kind: typeof KINDS[number], ids: string[]) {
  for (const id of ids) {
    if (kind === "collection") await tx.documentCollection.create({ data: { documentId, collectionId: id } });
    if (kind === "client") await tx.documentClient.create({ data: { documentId, clientId: id } });
    if (kind === "need") await tx.documentNeed.create({ data: { documentId, clientNeedId: id } });
    if (kind === "deal") await tx.documentDeal.create({ data: { documentId, dealId: id } });
    if (kind === "offer") await tx.documentCommercialOffer.create({ data: { documentId, commercialOfferId: id } });
    if (kind === "property") await tx.documentProperty.create({ data: { documentId, propertyId: id, kind: "document" } });
  }
}
export async function generateFromTemplate(actor: Actor, id: string, raw: unknown, preview = false) {
  parseInput(zUuid, id); const d = parseInput(generation, raw);
  const { row, v, data, m } = await loadVersion(id, d.versionId);
  if (!m.fields.every(f => f.roles.includes(actor.role))) throw new ForbiddenError("Поля шаблона недоступны вашей роли");
  if (m.entityKind !== d.entityKind) fail("Шаблон не предназначен для этой записи");
  if (d.selectedIds && row.format !== "xlsx_registry") fail("Выбор нескольких записей доступен для XLSX-реестра");
  const ids = [...new Set(d.selectedIds ?? [d.entityId])];
  if (!ids.includes(d.entityId)) fail("Основная запись должна входить в выбранные");
  let storedKey: string | undefined;
  try { return await transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM document_templates WHERE id = ${id}::uuid FOR SHARE`));
    const contexts = [];
    for (const entityId of ids) contexts.push(projectContext(await buildContext(tx, actor, d.entityKind, entityId), m, actor.role));
    if (d.requestId && !preview) {
      await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${d.requestId}, 0))::text`));
      const prior = await tx.document.findUnique({ where: { id: d.requestId } });
      if (prior) {
        const source = (prior.valuesSnapshot as { source?: unknown } | null)?.source;
        if (prior.uploadedBy !== actor.userId || prior.templateVersionId !== v.id || JSON.stringify((source as {ids?: string[]})?.ids) !== JSON.stringify(ids) || (source as {kind?: string})?.kind !== d.entityKind) fail("Идентификатор запроса уже использован");
        return { id: prior.id };
      }
    }
    const rendered = await renderDocument(row.format, v.markdownBody, data, contexts, m, actor.role);
    if (preview) return { ...rendered, id: null };
    if (!await tx.documentTemplate.count({ where: { id, status: "active" } })) throw new NotFoundError();
    const storage = getStorage(), stored = await storage.put(rendered.data); storedKey = stored.storageKey;
    const accessRoles = ["manager", "realtor"].filter(role => m.fields.every(f => f.roles.includes(role as "manager" | "realtor")));
    if (!accessRoles.includes("manager")) accessRoles.push("manager");
    const inherited = d.entityKind === "deal" ? await tx.deal.findUnique({ where: { id: d.entityId }, select: { legalEntityId: true } }) : d.entityKind === "offer" ? await tx.commercialOffer.findUnique({ where: { id: d.entityId }, select: { legalEntityId: true } }) : null;
    const doc = await tx.document.create({ data: { id: d.requestId, originalName: `${row.code}-v${v.version}.${rendered.extension}`, documentTypeCode: d.entityKind === "offer" ? "commercial_offer" : "other", mimeType: MIME[rendered.extension], fileSize: BigInt(stored.size), checksum: stored.sha256, storageProvider: storage.provider, storageKey: stored.storageKey, uploadedBy: actor.userId, legalEntityId: inherited?.legalEntityId, templateVersionId: v.id, valuesSnapshot: { accessRoles, source: { kind: d.entityKind, ids }, values: contexts } as Prisma.InputJsonValue } });
    await linkDocument(tx, doc.id, d.entityKind, ids);
    await writeAudit(tx, { actorUserId: actor.userId, action: "document.template_generated", entityType: "Document", entityId: doc.id, after: { templateVersionId: v.id, sourceKind: d.entityKind, count: ids.length } });
    return { id: doc.id };
  }); } catch (e) { if (storedKey) await getStorage().remove(storedKey); throw e; }
}
export async function openTemplateDocument(actor: Actor, id: string) {
  parseInput(zUuid, id);
  const doc = await db.document.findFirst({ where: { id, templateVersionId: { not: null } }, include: { collectionLinks: true } });
  if (!doc || doc.uploadedBy !== actor.userId && actor.role !== "manager") throw new NotFoundError();
  if (actor.role !== "manager" && !(doc.valuesSnapshot as { accessRoles?: string[] } | null)?.accessRoles?.includes(actor.role)) throw new NotFoundError();
  const source = z.object({ kind: z.enum(KINDS), ids: z.array(zUuid).min(1).max(LIMITS.records) }).parse((doc.valuesSnapshot as { source?: unknown } | null)?.source);
  const ids = source.kind === "collection" ? doc.collectionLinks.map(link => link.collectionId) : source.ids;
  if (!ids.length) throw new NotFoundError();
  for (const entityId of ids) await buildContext(db, actor, source.kind, entityId);
  return { ...await getStorage().read(doc.storageKey), mimeType: doc.mimeType, fileName: doc.originalName };
}
export async function listGeneratedDocuments(actor: Actor, raw: unknown) {
  const d = parseInput(z.object({ entityKind: z.enum(KINDS), entityId: zUuid }).strict(), raw);
  await buildContext(db, actor, d.entityKind, d.entityId);
  const rows = await db.document.findMany({ where: { templateVersionId: { not: null }, archivedAt: null,
    AND: [...(d.entityKind === "collection" ? [{ collectionLinks: { some: { collectionId: d.entityId } } }] : [{ valuesSnapshot: { path: ["source", "kind"], equals: d.entityKind } }, { valuesSnapshot: { path: ["source", "ids"], array_contains: [d.entityId] } }]), ...(actor.role === "manager" ? [] : [{ uploadedBy: actor.userId }, { valuesSnapshot: { path: ["accessRoles"], array_contains: [actor.role] } }])] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 50, select: { id: true, originalName: true, createdAt: true, valuesSnapshot: true, collectionLinks: true } });
  const output = [];
  for (const row of rows) {
    const ids = d.entityKind === "collection" ? row.collectionLinks.map(link => link.collectionId) : (row.valuesSnapshot as { source: { ids: string[] } }).source.ids;
    try { for (const id of ids) await buildContext(db, actor, d.entityKind, id); }
    catch (e) { if (e instanceof NotFoundError) continue; throw e; }
    output.push({ id: row.id, name: row.originalName, createdAt: row.createdAt.toISOString() });
  }
  return output;
}
