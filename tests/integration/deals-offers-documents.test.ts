import { beforeEach, describe, expect, it } from "vitest";
import { apiRequest, db, inDays, makeClient, makeNeed, makeProperty, readBody, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
import { createDeal, closeDeal, addCommission, updateCommission } from "@/modules/deals/application/deal-service";
import { createOffer, changeOfferStatus, getOffer } from "@/modules/commercial-offers/application/offer-service";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";
import { updateProperty } from "@/modules/properties/application/property-service";
import { storeDocument, openDocumentForDownload } from "@/modules/documents/application/document-service";
import { GET as downloadRoute } from "@/app/api/v1/documents/[id]/download/route";
import { POST as uploadRoute } from "@/app/api/v1/documents/route";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { NextRequest } from "next/server";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

describe("T06: сделка, ИП/ООО, участники, комиссии, постсделочная задача", () => {
  it("создание и закрытие сделки; руководитель — ответственный по умолчанию; клиент не архивируется", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const prop = await makeProperty(u.realtor1);
    await expect(createDeal(u.realtor1, { propertyId: prop.id, legalEntityId: u.llcId, parties: [] })).rejects.toBeInstanceOf(ValidationError);
    const { id: dealId } = await createDeal(u.realtor1, {
      propertyId: prop.id,
      legalEntityId: u.ipId,
      dealPrice: "12345678901234.56",
      parties: [
        { clientId, partyRole: "tenant" },
        { externalPartyName: "ООО «Арендодатель» (внешняя сторона)", partyRole: "landlord" },
      ],
      commissions: [{ amount: "45000.50", status: "planned", dueAt: "2026-12-01", payerPartyIndex: 0 }],
    });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { commissions: true, parties: true } });
    expect(deal.legalEntityId).toBe(u.ipId);
    expect(deal.dealPrice?.toString()).toBe("12345678901234.56"); // без потери точности
    expect(deal.commissions[0]!.amount.toString()).toBe("45000.5");
    expect(deal.commissions[0]!.payerPartyId).toBe(deal.parties.find((p) => p.clientId === clientId)!.id);

    // Несколько комиссионных обязательств без изменения схемы
    const c2 = await addCommission(u.realtor1, dealId, { amount: "10000", status: "due" });
    const c2row = await db.dealCommission.findUniqueOrThrow({ where: { id: c2.id } });
    await updateCommission(u.realtor1, dealId, c2.id, { expectedUpdatedAt: c2row.updatedAt.toISOString(), status: "received" });
    expect((await db.dealCommission.findUniqueOrThrow({ where: { id: c2.id } })).receivedAt).not.toBeNull();

    const fresh = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    // Риелтор не может назначить постсделочную задачу второму риелтору
    await expect(
      closeDeal(u.realtor1, dealId, {
        expectedUpdatedAt: fresh.updatedAt.toISOString(),
        status: "completed",
        postdealTasks: [{ subtypeCode: "followup", title: "Связаться", dueAt: inDays(30), responsibleUserId: u.realtor2.userId }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const res = await closeDeal(u.realtor1, dealId, {
      expectedUpdatedAt: fresh.updatedAt.toISOString(),
      status: "completed",
      postdealTasks: [
        { subtypeCode: "rent_indexation", title: "Пересмотр арендной платы", dueAt: inDays(335), recurrenceKind: "yearly" },
        { subtypeCode: "invoice", title: "Выставить счёт", dueAt: inDays(3) },
      ],
    });
    const tasks = await db.task.findMany({ where: { id: { in: res.taskIds } }, include: { dealLinks: true, clientLinks: true } });
    expect(tasks).toHaveLength(2);
    for (const t of tasks) {
      expect(t.taskType).toBe("postdeal");
      expect(t.responsibleUserId).toBe(u.manager.userId);
      expect(t.dealLinks[0]!.dealId).toBe(dealId);
      expect(t.clientLinks.map((l) => l.clientId)).toContain(clientId);
    }
    expect(tasks.map((t) => t.taskSubtypeCode).sort()).toEqual(["invoice", "rent_indexation"]);
    expect((await db.client.findUniqueOrThrow({ where: { id: clientId } })).status).toBe("active");
    const actions = (await db.auditLog.findMany({ where: { entityId: dealId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["deal.created", "deal.commission_added", "deal.commission_changed", "deal.closed"]));
  });

  it("руководитель может явно выбрать другого ответственного за постсделочную задачу", async () => {
    const prop = await makeProperty(u.manager);
    const { id: dealId } = await createDeal(u.manager, { propertyId: prop.id, legalEntityId: u.llcId, parties: [{ externalPartyName: "Покупатель", partyRole: "buyer" }] });
    const d = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    const r = await closeDeal(u.manager, dealId, {
      expectedUpdatedAt: d.updatedAt.toISOString(),
      status: "completed",
      postdealTasks: [{ subtypeCode: "tax_declaration", title: "Декларация", dueAt: inDays(120), responsibleUserId: u.realtor2.userId }],
    });
    expect((await db.task.findUniqueOrThrow({ where: { id: r.taskIds[0]! } })).responsibleUserId).toBe(u.realtor2.userId);
  });

  it("риелтор не может включить в сделку чужого клиента", async () => {
    const { id: foreignClient } = await makeClient(u.realtor2);
    const prop = await makeProperty(u.realtor1);
    await expect(createDeal(u.realtor1, { propertyId: prop.id, legalEntityId: u.llcId, parties: [{ clientId: foreignClient, partyRole: "buyer" }] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("T10: коммерческое предложение со snapshot и документом", () => {
  it("snapshot сохраняется после изменения цены; документ наследует legal_entity_id", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: needId } = await makeNeed(u.realtor1, clientId);
    const p1 = await makeProperty(u.realtor1, { price: "100000.00", area: "75" });
    const p2 = await makeProperty(u.realtor2, { price: "120000.00", area: "90" });
    const { id: offerId } = await createOffer(u.realtor1, {
      clientNeedId: needId,
      title: "Подборка помещений",
      introText: "Предлагаем варианты",
      items: [{ propertyId: p2.id }, { propertyId: p1.id, termsSnapshot: "аренда, без комиссии" }],
    });
    const before = await getOffer(u.realtor1, offerId);
    expect(before.offer.items.map((i) => i.propertyId)).toEqual([p2.id, p1.id]);
    expect(before.offer.items[1]!.termsSnapshot).toBe("аренда, без комиссии");

    // prepared требует ИП/ООО
    await expect(changeOfferStatus(u.realtor1, offerId, { expectedUpdatedAt: before.offer.updatedAt.toISOString(), status: "prepared" })).rejects.toBeInstanceOf(ValidationError);
    await db.commercialOffer.update({ where: { id: offerId }, data: { legalEntityId: u.llcId } });
    const v1 = await db.commercialOffer.findUniqueOrThrow({ where: { id: offerId } });
    await changeOfferStatus(u.realtor1, offerId, { expectedUpdatedAt: v1.updatedAt.toISOString(), status: "prepared" });
    const v2 = await db.commercialOffer.findUniqueOrThrow({ where: { id: offerId } });
    await changeOfferStatus(u.realtor1, offerId, { expectedUpdatedAt: v2.updatedAt.toISOString(), status: "sent", followUp: { title: "Узнать решение по КП", dueAt: inDays(3) } });
    expect((await db.commercialOffer.findUniqueOrThrow({ where: { id: offerId } })).sentAt).not.toBeNull();

    const docRef = await generateOfferDocument(u.realtor1, offerId);
    const doc = await db.document.findUniqueOrThrow({ where: { id: docRef.id }, include: { offerLinks: true } });
    expect(doc.legalEntityId).toBe(u.llcId);
    expect(doc.documentTypeCode).toBe("commercial_offer");
    expect(doc.offerLinks[0]!.commercialOfferId).toBe(offerId);
    expect(Number(doc.fileSize)).toBeGreaterThan(1000);

    // Изменение текущей цены объекта не меняет предложение
    const prop = await db.property.findUniqueOrThrow({ where: { id: p1.id } });
    await updateProperty(u.realtor1, p1.id, { expectedUpdatedAt: prop.updatedAt.toISOString(), price: "150000.00" });
    const after = await getOffer(u.realtor1, offerId);
    expect(after.offer.items.find((i) => i.propertyId === p1.id)!.priceSnapshot!.toString()).toBe("100000");
    expect(after.priceChanged).toHaveLength(1);
  });
});

describe("T05: документы недоступной сущности не выдаются", () => {
  it("риелтор не скачивает файл чужого клиента ни по id, ни зная storage key", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: docId } = await storeDocument(u.realtor1.userId, {
      data: Buffer.from("%PDF-1.4 синтетический документ"),
      originalName: "паспорт-сделки.pdf",
      mimeType: "application/pdf",
      documentTypeCode: "other",
      link: { kind: "client", id: clientId },
      legalEntityId: null,
    });
    await expect(openDocumentForDownload(u.realtor2, docId)).rejects.toBeInstanceOf(NotFoundError);
    const res2 = await downloadRoute(apiRequest("GET", `/api/v1/documents/${docId}/download`, { cookie: await sessionCookieFor(u.realtor2) }), routeParams({ id: docId }));
    expect(res2.status).toBe(404);
    const res1 = await downloadRoute(apiRequest("GET", `/api/v1/documents/${docId}/download`, { cookie: await sessionCookieFor(u.realtor1) }), routeParams({ id: docId }));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-disposition")).toContain("attachment");
    expect(await res1.text()).toContain("%PDF");
    // storage key в ответах API не раскрывается
    const doc = await db.document.findUniqueOrThrow({ where: { id: docId } });
    expect(JSON.stringify(Object.fromEntries(res1.headers))).not.toContain(doc.storageKey);
  });

  it("фото объекта видно всем, правоустанавливающий документ — только при доступе к контактам собственника", async () => {
    const prop = await makeProperty(u.realtor1);
    const photo = await storeDocument(u.realtor1.userId, { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), originalName: "фасад.png", mimeType: "image/png", documentTypeCode: "photo", link: { kind: "property", id: prop.id }, legalEntityId: null });
    const title = await storeDocument(u.realtor1.userId, { data: Buffer.from("%PDF выписка"), originalName: "выписка.pdf", mimeType: "application/pdf", documentTypeCode: "title_document", link: { kind: "property", id: prop.id }, legalEntityId: null });
    await expect(openDocumentForDownload(u.realtor2, photo.id)).resolves.toBeTruthy();
    await expect(openDocumentForDownload(u.realtor2, title.id)).rejects.toBeInstanceOf(NotFoundError);
    await db.propertyContactGrant.create({ data: { propertyId: prop.id, userId: u.realtor2.userId, grantedBy: u.manager.userId } });
    await expect(openDocumentForDownload(u.realtor2, title.id)).resolves.toBeTruthy();
  });

  it("загрузка: исполняемый файл и превышение лимита отклоняются сервером", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const cookie = await sessionCookieFor(u.realtor1);
    async function upload(name: string, content: Buffer) {
      const fd = new FormData();
      fd.set("file", new File([new Uint8Array(content)], name));
      fd.set("documentTypeCode", "other");
      fd.set("linkKind", "client");
      fd.set("linkId", clientId);
      const req = new NextRequest("http://crm.test/api/v1/documents", { method: "POST", body: fd, headers: { cookie, origin: "http://crm.test", host: "crm.test" } });
      return uploadRoute(req, routeParams({}));
    }
    expect((await upload("ok.pdf", Buffer.from("%PDF-1.4 ok"))).status).toBe(201);
    expect((await upload("virus.exe", Buffer.from("MZ..."))).status).toBe(400);
    expect((await upload("fake.pdf", Buffer.from("MZ\x90\x00"))).status).toBe(400);
    const big = await upload("big.txt", Buffer.alloc(3 * 1024 * 1024, 97)); // MAX_UPLOAD_MB=2 в тестах
    expect(big.status).toBe(400);
    expect((await readBody<{ error: { fieldErrors: Record<string, string[]> } }>(big)).error.fieldErrors.file).toBeTruthy();
    // Чужой клиент: 404 и файл не остаётся в хранилище
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(Buffer.from("%PDF x"))], "x.pdf"));
    fd.set("documentTypeCode", "other");
    fd.set("linkKind", "client");
    fd.set("linkId", clientId);
    const foreign = await uploadRoute(new NextRequest("http://crm.test/api/v1/documents", { method: "POST", body: fd, headers: { cookie: await sessionCookieFor(u.realtor2), origin: "http://crm.test", host: "crm.test" } }), routeParams({}));
    expect(foreign.status).toBe(404);
    expect(await db.document.count()).toBe(1);
  });
});
