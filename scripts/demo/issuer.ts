import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { db, demoId, type DemoContext } from "./context";
import { getStorage } from "@/shared/storage/storage-adapter";

export async function seedDemoIssuers(ctx: DemoContext) {
  const logo = await sharp(Buffer.from(`<svg width="240" height="140"><rect width="240" height="140" rx="12" fill="#174b61"/><path d="M30 95V52L65 28l35 24v43H75V65H55v30Z" fill="#fff"/><text x="115" y="68" font-family="Arial" font-size="23" fill="white">CRM</text><text x="115" y="95" font-family="Arial" font-size="16" fill="white">DEMO</text></svg>`)).png().toBuffer();
  await mkdir("scripts/demo/assets", { recursive: true });
  await writeFile("scripts/demo/assets/demo-logo.png", logo);
  const entities = await db.legalEntity.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
  for (const [index, entity] of entities.entries()) {
    const id = demoId(`issuer-logo:${entity.id}`);
    if (!await db.document.findUnique({ where: { id } })) {
      const stored = await getStorage().put(logo);
      await db.document.create({ data: { id, originalName: "demo-logo.png", documentTypeCode: "photo", mimeType: "image/png",
        fileSize: stored.size, storageKey: stored.storageKey, checksum: stored.sha256, uploadedBy: ctx.manager.userId, legalEntityId: entity.id,
        propertyLinks: { create: { propertyId: ctx.properties.at(-1)!.id, kind: "document", caption: "ДЕМО логотип агентства", sortOrder: 100 } },
      } });
    }
    await db.documentProperty.deleteMany({ where: { documentId: id, propertyId: { not: ctx.properties.at(-1)!.id } } });
    await db.documentProperty.upsert({ where: { documentId_propertyId: { documentId: id, propertyId: ctx.properties.at(-1)!.id } }, update: {},
      create: { documentId: id, propertyId: ctx.properties.at(-1)!.id, kind: "document", caption: "ДЕМО логотип агентства", sortOrder: 100 } });
    await db.legalEntity.update({ where: { id: entity.id }, data: {
      logoDocumentId: id,
      requisites: `ДЕМО · вымышленные реквизиты, не для расчётов\nИНН 0000000000 · ОГРН 0000000000000 (демо-образцы)\nАдрес: г. Новосибирск, ул. Демонстрационная, д. ${index + 1}, офис 1\nТелефон: +7 900 000-00-${String(index + 1).padStart(2, "0")} · Сайт: example.ru`,
    } });
  }
}
