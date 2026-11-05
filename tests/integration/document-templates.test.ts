import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeProperty, type TestUsers } from "../helpers/fixtures";
import { clientYaml, collectionYaml, docxFixture, xlsxFixture } from "../helpers/template-fixtures";
import { saveTemplate, generateFromTemplate, changeTemplateStatus, openTemplateDocument, previewTemplate, listGeneratedDocuments } from "@/modules/document-templates/application/template-service";
import { getStorage } from "@/shared/storage/storage-adapter";
import { readPackage } from "@/modules/document-templates/domain/package";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
let u: TestUsers;
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
const meta = (code: string, format: string, manifestYaml = clientYaml) => ({ code, name: "Тестовый шаблон", format, manifestYaml, markdownBody: "# Клиент\n{{client.displayName}}" });
describe("AT-15 версии и четыре режима на PostgreSQL", () => {
  it("DocumentCollection is unique, restricts deletion and drives history independently of snapshot IDs", async () => {
    const c = await db.propertyCollection.create({ data: { name: "Связанная подборка", ownerUserId: u.realtor1.userId } });
    const other = await db.propertyCollection.create({ data: { name: "Другая подборка", ownerUserId: u.realtor1.userId } });
    const p = await makeProperty(u.realtor1);
    await db.propertyCollectionItem.create({ data: { collectionId: c.id, propertyId: p.id, addedBy: u.realtor1.userId, status: "in_crm" } });
    const t = await saveTemplate(u.manager, { ...meta("collection_link", "markdown_docx", collectionYaml), markdownBody: "{{collection.name}}" }, null);
    const generated = await generateFromTemplate(u.realtor1, t.id, { entityKind: "collection", entityId: c.id });
    const doc = await db.document.findUniqueOrThrow({ where: { id: generated.id! }, include: { collectionLinks: true } });
    expect(doc.collectionLinks).toEqual([{ documentId: doc.id, collectionId: c.id }]);
    await expect(db.documentCollection.create({ data: { documentId: doc.id, collectionId: c.id } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.propertyCollection.delete({ where: { id: c.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.document.delete({ where: { id: doc.id } })).rejects.toMatchObject({ code: "P2003" });
    await db.document.update({ where: { id: doc.id }, data: { valuesSnapshot: { accessRoles: ["manager", "realtor"], source: { kind: "collection", ids: [other.id] } } } });
    expect(await listGeneratedDocuments(u.realtor1, { entityKind: "collection", entityId: c.id })).toHaveLength(1);
    expect(await listGeneratedDocuments(u.realtor1, { entityKind: "collection", entityId: other.id })).toHaveLength(0);
  });
  it("новая версия работает без перезапуска; Document хранит снимок; архив не удаляет прежний файл", async () => {
    const client = await makeClient(u.realtor1, { displayName: "Синтетика до изменения" });
    const t = await saveTemplate(u.manager, meta("client_card", "markdown_docx"), null);
    const generated = await generateFromTemplate(u.realtor1, t.id, { entityKind: "client", entityId: client.id });
    expect(generated.id).toBeTruthy();
    const doc = await db.document.findUniqueOrThrow({ where: { id: generated.id! }, include: { clientLinks: true, templateVersion: true } });
    expect(doc.clientLinks[0]?.clientId).toBe(client.id); expect(doc.templateVersion?.version).toBe(1); expect(JSON.stringify(doc.valuesSnapshot)).toContain("Синтетика до изменения");
    const second = await saveTemplate(u.manager, { ...meta("client_card", "markdown_docx"), markdownBody: "# Редакция 2\n{{client.displayName}}" }, null, t.id, t.updatedAt.toISOString());
    await expect(saveTemplate(u.manager, meta("client_card", "markdown_docx"), null, t.id, t.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 });
    const next = await generateFromTemplate(u.realtor1, t.id, { entityKind: "client", entityId: client.id });
    expect((await db.document.findUniqueOrThrow({ where: { id: next.id! }, include: { templateVersion: true } })).templateVersion?.version).toBe(2);
    await db.client.update({ where: { id: client.id }, data: { displayName: "Новое имя" } });
    await changeTemplateStatus(u.manager, t.id, { status: "archived", expectedUpdatedAt: second.updatedAt.toISOString() });
    await expect(generateFromTemplate(u.realtor1, t.id, { entityKind: "client", entityId: client.id })).rejects.toMatchObject({ status: 404 });
    const opened = await openTemplateDocument(u.realtor1, doc.id); let size = 0; for await (const c of opened.stream) size += c.length; expect(size).toBe(Number(doc.fileSize));
    expect(JSON.stringify((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).valuesSnapshot)).toContain("Синтетика до изменения");
  });
  it("повтор подтверждения с requestId сохраняет ровно один документ", async () => {
    const a = await makeClient(u.realtor1), t = await saveTemplate(u.manager, meta("repeat_safe", "markdown_docx"), null);
    const input = { entityKind: "client", entityId: a.id, requestId: randomUUID() };
    const [first, second] = await Promise.all([generateFromTemplate(u.realtor1, t.id, input), generateFromTemplate(u.realtor1, t.id, input)]);
    expect(first.id).toBe(second.id); expect(await db.document.count()).toBe(1);
  });
  it("генерирует DOCX, XLSX, реестр и preview без записи", async () => {
    const c = await db.propertyCollection.create({ data: { name: "Тестовая подборка", ownerUserId: u.realtor1.userId } });
    const p = await makeProperty(u.realtor1); await db.propertyCollectionItem.create({ data: { collectionId: c.id, propertyId: p.id, addedBy: u.realtor1.userId, status: "in_crm" } });
    for (const format of ["docx", "xlsx"] as const) {
      const binary = format === "docx" ? await docxFixture() : await xlsxFixture();
      const t = await saveTemplate(u.manager, { ...meta(`collection_${format}`, format, collectionYaml), markdownBody: undefined }, new File([new Uint8Array(binary)], `sample.${format}`));
      const count = await db.document.count(); const preview = await previewTemplate(u.manager, t.id); expect(preview.data.length).toBeGreaterThan(500); expect(await db.document.count()).toBe(count);
      const generated = await generateFromTemplate(u.realtor1, t.id, { entityKind: "collection", entityId: c.id }); const doc = await db.document.findUniqueOrThrow({ where: { id: generated.id! } });
      const { stream } = await getStorage().read(doc.storageKey); const chunks = []; for await (const ch of stream) chunks.push(Buffer.from(ch)); const bytes = Buffer.concat(chunks); expect(Object.keys(readPackage(bytes)).length).toBeGreaterThan(3);
    }
    const a = await makeClient(u.realtor1, { displayName: "=1+1" }), b = await makeClient(u.realtor1, { displayName: "Второй клиент" });
    const registry = await saveTemplate(u.manager, meta("clients_registry", "xlsx_registry"), null);
    const generated = await generateFromTemplate(u.realtor1, registry.id, { entityKind: "client", entityId: a.id, selectedIds: [a.id, b.id] }); const doc = await db.document.findUniqueOrThrow({ where: { id: generated.id! } });
    expect(await db.documentClient.count({ where: { documentId: doc.id } })).toBe(2);
    const { stream } = await getStorage().read(doc.storageKey); const chunks = []; for await (const ch of stream) chunks.push(Buffer.from(ch)); const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.concat(chunks) as never); expect(book.worksheets[0]!.getCell("A2").value).toBe("'=1+1"); expect(book.worksheets[0]!.rowCount).toBe(3);
  });
});
