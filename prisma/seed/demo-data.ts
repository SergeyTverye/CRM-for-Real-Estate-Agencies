import type { PrismaClient } from "../../src/generated/prisma/client";
import type { Actor } from "../../src/modules/auth/domain/actor";
import { createClient } from "../../src/modules/clients/application/client-service";
import { createProperty, addPropertyOwner } from "../../src/modules/properties/application/property-service";
import { createNeed } from "../../src/modules/needs/application/need-service";
import { proposeProperties } from "../../src/modules/matching/application/matching-service";
import { scheduleShowing } from "../../src/modules/showings/application/showing-service";
import { createAgreement } from "../../src/modules/agreements/application/agreement-service";
import { createAdvertisement } from "../../src/modules/advertisements/application/advertisement-service";
import { createDeal } from "../../src/modules/deals/application/deal-service";
import { registerRequest } from "../../src/modules/requests/application/request-service";

/**
 * Демонстрационные синтетические данные (SEED_DEMO_DATA=true) для показа и обучения.
 * Создаются через application-сервисы, поэтому соблюдают бизнес-инварианты.
 * Все имена, телефоны и адреса вымышлены (диапазон +7 900 000-..). Повторный запуск не дублирует данные.
 */
const inDays = (d: number, hour = 11) => {
  const x = new Date(Date.now() + d * 86_400_000);
  x.setUTCHours(hour - 3, 0, 0, 0);
  return x.toISOString();
};
const dateOnly = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function actorOf(db: PrismaClient, login: string): Promise<Actor | null> {
  const u = await db.user.findUnique({ where: { login } });
  if (!u) return null;
  return { userId: u.id, login: u.login, displayName: u.displayName, role: u.roleCode as Actor["role"], mustChangePassword: false, sessionId: "00000000-0000-4000-8000-000000000000" };
}

export async function seedDemoData(db: PrismaClient): Promise<string> {
  if (await db.client.count({ where: { notes: { startsWith: "[демо]" } } })) return "уже загружены";
  const manager = await actorOf(db, process.env.SEED_MANAGER_LOGIN ?? "manager");
  const r1 = await actorOf(db, process.env.SEED_REALTOR1_LOGIN ?? "realtor1");
  const r2 = await actorOf(db, process.env.SEED_REALTOR2_LOGIN ?? "realtor2");
  if (!manager || !r1 || !r2) return "нет учётных записей для демо";
  const llc = await db.legalEntity.findFirst({ where: { entityType: "LLC", isActive: true } });
  if (!llc) return "нет юрлица";

  const p1 = await createProperty(r1, { propertyType: "commercial", propertySubtype: "retail", operationType: "rent", sourceType: "agency_listing", addressText: "ул. Демонстрационная, д. 1, пом. 2", district: "Центральный", area: "85", price: "95000", floor: 1, commercialPurpose: "retail", powerKw: "20", parkingAvailable: true, description: "Помещение на первой линии, отдельный вход" });
  const p2 = await createProperty(r2, { propertyType: "commercial", propertySubtype: "office", operationType: "rent", sourceType: "agency_listing", addressText: "пр. Учебный, д. 15, оф. 301", district: "Северный", area: "60", price: "70000", floor: 3, commercialPurpose: "office" });
  const p3 = await createProperty(r1, { propertyType: "residential", propertySubtype: "apartment", operationType: "sale", sourceType: "agency_listing", addressText: "ул. Примерная, д. 7, кв. 12", district: "Южный", area: "54", price: "6800000", roomsCount: 2, floor: 5, floorsTotal: 9 });
  const p4 = await createProperty(manager, { propertyType: "commercial", propertySubtype: "warehouse", operationType: "sale", sourceType: "external_market", sourcePlatformCode: "avito", sourceUrl: "https://example.invalid/market/1", addressText: "ул. Складская, д. 3", area: "400", price: "21000000", responsibleUserId: null });

  await addPropertyOwner(r1, p1.id, { newClient: { displayName: "Собственников Демо", notes: "[демо] собственник", contacts: [{ contactType: "phone", value: "+7 900 000-01-01" }] }, ownerRole: "собственник" });
  await createAdvertisement(r1, { propertyId: p1.id, platformCode: "avito", url: "https://example.invalid/ad/101", adText: "Сдаётся торговое помещение 85 м²", status: "active", expiresAt: dateOnly(5) });
  await createAgreement(r1, { propertyId: p1.id, agreementType: "exclusive", status: "signed", signedAt: dateOnly(-300), validFrom: dateOnly(-300), validUntil: dateOnly(20), isExclusive: true, legalEntityId: llc.id });
  await createAgreement(r2, { propertyId: p2.id, agreementType: "information", status: "no_agreement", absenceReasonCode: "owner_refused", actionRequired: "Повторно предложить информационный договор" });

  const c1 = await createClient(r1, { displayName: "ООО «Демо-Ритейл»", clientKind: "organization", notes: "[демо] арендатор", contacts: [{ contactType: "phone", value: "+7 900 000-02-02" }, { contactType: "email", value: "demo-retail@example.invalid" }] });
  const n1 = await createNeed(r1, { clientId: c1.id, operationType: "rent", propertyType: "commercial", propertySubtype: "retail", budgetMax: "110000", areaMin: "60", areaMax: "120", district: "Центр", powerRequirement: "15", parkingRequirement: true, nextAction: { title: "Согласовать время показа", dueAt: inDays(0, 15), taskType: "call_or_contact" } });
  await proposeProperties(r1, n1.id, { propertyIds: [p1.id, p2.id], comment: "Подборка по бюджету и площади" });
  await scheduleShowing(r1, { clientNeedId: n1.id, propertyId: p1.id, scheduledAt: inDays(1, 12) });

  const c2 = await createClient(r1, { displayName: "Демонстров Иван", notes: "[демо] покупатель", contacts: [{ contactType: "phone", value: "+7 900 000-03-03" }] });
  await createNeed(r1, { clientId: c2.id, operationType: "buy", propertyType: "residential", budgetMax: "7000000", roomsMin: 2, financingType: "mortgage", mortgageStatus: "in_progress", nextAction: { title: "Уточнить одобрение ипотеки", dueAt: inDays(-1, 10), taskType: "call_or_contact" } });

  const c3 = await createClient(r2, { displayName: "Учебная Мария", notes: "[демо] арендатор офиса", contacts: [{ contactType: "phone", value: "+7 900 000-04-04" }] });
  await createNeed(r2, { clientId: c3.id, operationType: "rent", propertyType: "commercial", propertySubtype: "office", areaMin: "40", budgetMax: "80000", nextAction: { title: "Отправить подборку офисов", dueAt: inDays(2, 11), taskType: "commercial_offer" } });

  await registerRequest(r2, {
    occurredAt: inDays(0, 9),
    channelCode: "phone",
    sourceCode: "avito",
    summary: "Звонок по объявлению: интересуется торговым помещением",
    propertyId: p1.id,
    client: { mode: "new", client: { displayName: "Звонков Пётр", notes: "[демо] звонок по объявлению", contacts: [{ contactType: "phone", value: "+7 900 000-05-05" }] } },
    outcome: { resultCode: "new_need", need: { operationType: "rent", propertyType: "commercial" }, nextAction: { title: "Перезвонить по объекту", dueAt: inDays(0, 16), taskType: "call_or_contact" } },
  });

  await createDeal(r1, {
    propertyId: p3.id,
    legalEntityId: llc.id,
    status: "documents",
    dealPrice: "6750000",
    parties: [{ clientId: c2.id, partyRole: "buyer" }, { externalPartyName: "Продавец (внешняя сторона)", partyRole: "seller" }],
    commissions: [{ amount: "120000", status: "planned", dueAt: dateOnly(30), payerPartyIndex: 0 }],
  });
  void p4;
  return "клиенты 5, объекты 4, потребности 4, показ, договоры, реклама, сделка";
}
