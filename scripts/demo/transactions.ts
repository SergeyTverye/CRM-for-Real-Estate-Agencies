import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, day, demoId, marker, type DemoContext } from "./context";
import { uploadPropertyMedia, updatePropertyMedia } from "@/modules/properties/application/property-media-service";
import { createOffer, changeOfferStatus, createOfferRevision } from "@/modules/commercial-offers/application/offer-service";
import { dealChecklistTemplate } from "@/modules/deals/domain/checklist-template";
import { writeAudit } from "@/modules/audit/application/audit";

export async function seedGallery(ctx: DemoContext, properties = ctx.properties, offset = 0) {
  const dir = path.resolve("scripts/demo/assets");
  await mkdir(dir, { recursive: true });
  for (const [index, property] of properties.entries()) {
    const i = offset + index;
    const actor = ctx.agents.find(a => a.userId === property.responsibleUserId)!;
    for (let j = 0; j < 3 + i % 4; j++) {
      const originalName = `property-${i + 1}-${j + 1}.jpg`;
      if (await db.documentProperty.count({ where: { propertyId: property.id, document: { originalName }, caption: { not: null } } })) continue;
      const filePath = path.join(dir, originalName);
      let data: Buffer;
      try { data = await readFile(filePath); } catch {
        const svg = `<svg width="960" height="640"><rect width="960" height="640" fill="#174b61"/><text x="60" y="290" fill="white" font-size="66">Объект ${i + 1}</text><text x="60" y="370" fill="white" font-size="48">ДЕМО · вид ${j + 1}</text></svg>`;
        data = await sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toBuffer();
        await sharp(data).toFile(filePath);
      }
      const document = await uploadPropertyMedia(actor, property.id, new File([new Uint8Array(data)], originalName, { type: "image/jpeg" }), { kind: "photo" });
      await updatePropertyMedia(actor, property.id, document.id, { caption: `${marker} Синтетическая иллюстрация: ${["главный вид", "торговый зал", "планировка", "вход", "рабочая зона", "фасад"][j]}`, sortOrder: j, isCover: j === 0 });
    }
    if (i < 4) for (let j = 0; j < 2; j++) {
      const originalName = `demo-property-${i + 1}-document-${j + 1}.txt`;
      if (await db.documentProperty.count({ where: { propertyId: property.id, document: { originalName } } })) continue;
      const document = await uploadPropertyMedia(actor, property.id, new File([`${marker}\nВЫМЫШЛЕННЫЙ МАТЕРИАЛ ДЛЯ ДЕМОНСТРАЦИИ\nОбъект ${i + 1}. ${j ? "Техническое описание" : "Учебный перечень документов"}. Не является юридическим документом.`], originalName, { type: "text/plain" }), { kind: "document", documentTypeCode: "other" });
      await updatePropertyMedia(actor, property.id, document.id, { caption: `${marker} ${j ? "Техническое описание" : "Учебный перечень"}`, sortOrder: 20 + j });
    }
  }
}

export async function seedMediaAndOffers(ctx: DemoContext) {
  await seedGallery(ctx);
  const legalEntity = await db.legalEntity.findFirstOrThrow({ where: { isActive: true }, orderBy: { id: "asc" } });
  for (const [i, title] of [`${marker} Подборка — черновик`, `${marker} Подборка — отправлено`].entries()) {
    // Revisions intentionally inherit the title; they must never become the source on rerun.
    let offer = await db.commercialOffer.findFirst({ where: { title, clientNeedId: ctx.needs[i * 4]!.id, promptTemplateVersion: null } });
    if (!offer) {
      const created = await createOffer(ctx.agents[0]!, { clientNeedId: ctx.needs[i * 4]!.id, title, legalEntityId: legalEntity.id, notes: marker,
        introText: "Демонстрационное предложение. Все объекты и условия вымышлены.", expiresAt: day(ctx.origin, 14).toISOString().slice(0, 10),
        items: [0, 2, 4].map(offset => ({ propertyId: ctx.properties[offset + i * 4]!.id, comment: "Демонстрационные условия, требуется согласование" })),
      });
      offer = await db.commercialOffer.findUniqueOrThrow({ where: { id: created.id } });
    }
    if (i === 1) {
      for (const status of ["prepared", "sent"]) {
        if (offer.status !== (status === "prepared" ? "draft" : "prepared")) continue;
        await changeOfferStatus(ctx.agents[0]!, offer.id, { status, expectedUpdatedAt: offer.updatedAt.toISOString(), onBehalfOfCompany: true });
        offer = await db.commercialOffer.findUniqueOrThrow({ where: { id: offer.id } });
      }
      if (!await db.commercialOffer.count({ where: { promptTemplateVersion: `revision-of:${offer.id}` } })) await createOfferRevision(ctx.agents[0]!, offer.id, { expectedUpdatedAt: offer.updatedAt.toISOString() });
    }
  }
}

export async function seedDeals(ctx: DemoContext) {
  const legalEntity = await db.legalEntity.findFirstOrThrow({ where: { isActive: true }, orderBy: { id: "asc" } });
  // A single transaction per synthetic deal makes participants/commissions/history atomic.
  for (let i = 0; i < 4; i++) {
    const id = demoId(`deal:${i}`), property = ctx.properties[i]!, client = ctx.clients[i]!;
    const completed = i >= 2, rent = property.operationType === "rent";
    await db.$transaction(async tx => {
      if (!await tx.deal.count({ where: { id } })) {
        await tx.deal.create({ data: { id, propertyId: property.id, legalEntityId: legalEntity.id, responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId,
          status: completed ? "completed" : "documents", openedAt: day(ctx.origin, -30), mainAgreementAt: completed ? day(ctx.origin, -10) : null,
          closedAt: completed ? day(ctx.origin, -7) : null, dealPrice: property.price, notes: `${marker} ${rent ? "Аренда" : "Продажа"}: ${completed ? "завершена" : "в работе"}`,
          parties: { create: [{ id: demoId(`party:${i}:0`), clientId: client.id, partyRole: rent ? "tenant" : "buyer" }, { id: demoId(`party:${i}:1`), externalPartyName: `ООО «Демо Собственник ${i + 1}»`, partyRole: rent ? "landlord" : "seller" }] },
        } });
        await tx.dealCommission.createMany({ data: [0, 1].map(j => ({ id: demoId(`commission:${i}:${j}`), dealId: id, payerPartyId: demoId(`party:${i}:${j}`), amount: rent ? "45000.00" : "180000.00", status: completed && j === 0 ? "received" : "due", dueAt: day(ctx.origin, completed ? -7 : 3), receivedAt: completed && j === 0 ? day(ctx.origin, -7) : null, comment: `${marker} Комиссионное обязательство ${j + 1}` })) });
        await writeAudit(tx, { actorUserId: ctx.manager.userId, action: "demo.deal_created", entityType: "Deal", entityId: id, after: { demo: true, status: completed ? "completed" : "documents" } });
      }
      const file = await tx.documentProperty.findFirstOrThrow({ where: { propertyId: property.id, kind: "document" }, orderBy: { sortOrder: "asc" } });
      await tx.documentDeal.upsert({ where: { documentId_dealId: { documentId: file.documentId, dealId: id } }, update: {}, create: { documentId: file.documentId, dealId: id } });
      for (const item of dealChecklistTemplate(property.operationType)) {
        const status = ["verified", "review", "none", "not_required"][item.sortOrder % 4]!;
        await tx.dealChecklistItem.upsert({ where: { dealId_code: { dealId: id, code: item.code } }, update: {}, create: { ...item, dealId: id, status, responsibleUserId: client.responsibleUserId, checkedAt: status === "verified" ? day(ctx.origin, -8) : null, documentId: item.sortOrder === 0 ? file.documentId : null } });
      }
      const agreementId = demoId(`agreement:${i}`);
      await tx.agreement.upsert({ where: { id: agreementId }, update: {}, create: { id: agreementId, clientId: client.id, propertyId: property.id, dealId: id, responsibleUserId: client.responsibleUserId, legalEntityId: legalEntity.id,
        agreementType: rent ? "lease_related" : "sale_related", status: "signed", agreementNumber: `ДЕМО-${i + 1}`, signedAt: day(ctx.origin, -15), validFrom: day(ctx.origin, -15), validUntil: day(ctx.origin, i === 0 ? -1 : i + 3), notes: `${marker} Вымышленный договор, контроль продления`,
      } });
      if (completed) for (const [j, subtype] of ["invoice", "acceptance_act", rent ? "rent_indexation" : "tax_declaration", "followup"].entries()) {
        await tx.task.upsert({ where: { id: demoId(`postdeal:${i}:${j}`) }, update: {}, create: { id: demoId(`postdeal:${i}:${j}`), responsibleUserId: client.responsibleUserId, createdBy: ctx.manager.userId, taskType: "postdeal", taskSubtypeCode: subtype,
          title: `${marker} ${["Сверка расчётов и счёт", "Подписание акта", rent ? "Контроль продления аренды" : "Уточнить необходимость декларации", "Повторный контакт"][j]}`, dueAt: day(ctx.origin, j === 3 ? -1 : j + 2), status: "planned", priority: "normal",
          dealLinks: { create: { dealId: id } }, clientLinks: { create: { clientId: client.id } }, propertyLinks: { create: { propertyId: property.id } }, agreementLinks: { create: { agreementId } },
        } });
      }
    });
  }
}
