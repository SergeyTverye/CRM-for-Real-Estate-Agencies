/** Rebuild synthetic editable examples; --demo also exercises the running crm_demo schema. */
import "dotenv/config";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { clientYaml, collectionYaml, docxFixture, xlsxFixture } from "../../tests/helpers/template-fixtures";
const markdown = "# Карточка клиента\n\nКлиент: {{client.displayName}}\n\n## Порядок работы\n\n- Уточнить требования\n- Подготовить предложения\n\n| Поле | Значение |\n|---|---|\n| Клиент | {{client.displayName}} |\n| Сотрудник | {{user.displayName}} |\n";
async function main() {
  const root = "templates/examples";
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(`${root}/client.md`, markdown), writeFile(`${root}/client.yaml`, clientYaml),
    writeFile(`${root}/collection.yaml`, collectionYaml), writeFile(`${root}/registry.yaml`, clientYaml),
    writeFile(`${root}/collection.docx`, await docxFixture()), writeFile(`${root}/collection.xlsx`, await xlsxFixture()),
  ]);
  if (!process.argv.includes("--demo")) return;
  if (!process.env.DATABASE_URL?.endsWith("/crm_demo")) throw Error("Demo verification requires crm_demo");
  const { db, disconnectDb } = await import("../../src/shared/db/client");
  const { saveTemplate, generateFromTemplate, openTemplateDocument } = await import("../../src/modules/document-templates/application/template-service");
  try {
    const user = await db.user.findFirstOrThrow({ where: { roleCode: "manager", isActive: true } });
    const actor = { userId: user.id, role: "manager" as const, login: user.login, displayName: user.displayName, mustChangePassword: false, sessionId: randomUUID() };
    const clients = await db.client.findMany({ take: 2, orderBy: { createdAt: "asc" } });
    if (!clients[0]) throw Error("Demo clients required");
    let collection = await db.propertyCollection.findFirst({ where: { name: "Проверка шаблонов AT-15", ownerUserId: actor.userId } });
    if (!collection) {
      collection = await db.propertyCollection.create({ data: { name: "Проверка шаблонов AT-15", ownerUserId: actor.userId } });
      const properties = await db.property.findMany({ take: 3, orderBy: { createdAt: "asc" }, select: { id: true } });
      await db.propertyCollectionItem.createMany({ data: properties.map((p, i) => ({ collectionId: collection!.id, propertyId: p.id, addedBy: actor.userId, sortOrder: i, status: "in_crm" })) });
    }
    const output = "D:/crm-review/templates"; await mkdir(output, { recursive: true });
    const evidence = [];
    for (const format of ["markdown_docx", "docx", "xlsx", "xlsx_registry"] as const) {
      const isCollection = ["docx", "xlsx"].includes(format);
      const code = `at15_${format}`, existing = await db.documentTemplate.findUnique({ where: { code } });
      const file = isCollection ? new File([new Uint8Array(await readFile(`${root}/collection.${format}`))], `collection.${format}`) : null;
      const t = await saveTemplate(actor, { code, name: `Проверка AT-15: ${format}`, format, manifestYaml: isCollection ? collectionYaml : clientYaml, markdownBody: format === "markdown_docx" ? markdown : undefined, compatibilityNote: "Только синтетический пример; формулы Excel C3/B3 с относительным сдвигом, перенос длинных адресов" }, file, existing?.id, existing?.updatedAt.toISOString());
      const generated = await generateFromTemplate(actor, t.id, { entityKind: isCollection ? "collection" : "client", entityId: isCollection ? collection.id : clients[0].id, ...(format === "xlsx_registry" ? { selectedIds: clients.map(c => c.id) } : {}) });
      const doc = await openTemplateDocument(actor, generated.id!); const chunks = []; for await (const chunk of doc.stream) chunks.push(Buffer.from(chunk));
      const extension = format.includes("xlsx") ? "xlsx" : "docx"; await writeFile(`${output}/${format}.${extension}`, Buffer.concat(chunks));
      evidence.push({ format, documentId: generated.id, size: Buffer.concat(chunks).length });
    }
    await writeFile(`${output}/evidence.json`, JSON.stringify({ database: "crm_demo", synthetic: true, generatedAt: new Date().toISOString(), documents: evidence }, null, 2));
    console.log("AT-15: four formats generated and persisted on crm_demo");
  } finally { await disconnectDb(); }
}
main().catch(() => { console.error("Example generation failed; inspect configuration without printing credentials"); process.exitCode = 1; });
