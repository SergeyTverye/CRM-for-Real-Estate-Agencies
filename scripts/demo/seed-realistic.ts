/**
 * Реалистичный синтетический сид QA-стенда серверной версии (ветка feature/v3.2.3-qa-server).
 * Только для отдельной БД crm_qa. Идемпотентный: повторный запуск не дублирует записи.
 * Все данные вымышлены: ФИО/названия/телефоны +7 900 000-xx-xx, адреса — обобщённые.
 */
import { config as loadEnv } from "dotenv";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { getDb, disconnectDb } from "../../src/shared/db/client";
import { getStorage } from "../../src/shared/storage/storage-adapter";
import { uploadPropertyMedia, updatePropertyMedia } from "../../src/modules/properties/application/property-media-service";
import { generateNotifications } from "../../src/modules/notifications/application/notification-generator";
import type { Actor } from "../../src/modules/auth/domain/actor";

loadEnv({ path: [".env.local", ".env"], quiet: true });
const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl || new URL(dbUrl).pathname !== "/crm_qa") {
  throw new Error("seed-realistic requires DATABASE_URL ending in /crm_qa");
}
Object.assign(process.env, { SCRAPER_DEMO_FIXTURES: "true", SCRAPER_ENABLED: "true", AI_ENABLED: "true", LOG_LEVEL: "silent" });

const db = getDb();
const MARK = "[QA-V323]";
const qaId = (key: string) => {
  const hex = createHash("sha256").update(`crm-qa-v323:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// Детерминированный ГПСЧ: повторные прогоны дают те же данные.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(323323);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
const _ri = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
void _ri;

const day = (base: Date, days: number, hour = 10) => {
  const local = new Date(+base + 7 * 3600000 + days * 86400000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour - 7));
};

const SURNAMES_M = ["Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов", "Соколов", "Михайлов", "Новиков", "Федоров", "Морозов", "Волков", "Павлов", "Семенов", "Голубев", "Виноградов", "Богданов", "Воробьев", "Филиппов", "Максимов"];
const SURNAMES_F = ["Иванова", "Петрова", "Сидорова", "Кузнецова", "Смирнова", "Попова", "Соколова", "Михайлова", "Новикова", "Федорова", "Морозова", "Волкова", "Павлова", "Семенова", "Голубева", "Виноградова", "Богданова", "Воробьева", "Филиппова", "Максимова"];
const NAMES_M = ["Александр", "Дмитрий", "Сергей", "Андрей", "Алексей", "Михаил", "Игорь", "Владимир", "Николай", "Павел", "Роман", "Евгений", "Олег", "Юрий", "Тимур", "Артем", "Виктор", "Григорий", "Денис", "Кирилл"];
const NAMES_F = ["Елена", "Ольга", "Наталья", "Ирина", "Марина", "Светлана", "Татьяна", "Анна", "Юлия", "Дарья", "Екатерина", "Людмила", "Галина", "Вера", "Надежда", "Оксана", "Лариса", "Алла", "Жанна", "Ксения"];
const MID_M = ["Александрович", "Дмитриевич", "Сергеевич", "Андреевич", "Алексеевич", "Михайлович", "Игоревич", "Владимирович", "Николаевич", "Павлович"];
const MID_F = ["Александровна", "Дмитриевна", "Сергеевна", "Андреевна", "Алексеевна", "Михайловна", "Игоревна", "Владимировна", "Николаевна", "Павловна"];
const COMPANIES = ["Сибирь Трейд", "Новосиб Логистика", "Академ Софт", "Обь Ритейл", "Кольцово Парк", "СибАгроПродукт", "Восток Строй", "Меридиан Групп", "Атлант Сибирь", "Прогресс НСК", "Диапазон", "Квартал Плюс", "Сибирский Дом", "ТрансСибАвто", "ЭкоПродукт", "Фаворит Трейд", "Горизонт НСК", "Лидер Обь", "Сатурн Сибирь", "Орион Трейд"];
const COMPANY_FORMS = ["ООО", "ИП", "АО"];
const STREETS = ["Красный проспект", "ул. Ленина", "ул. Советская", "ул. Гоголя", "ул. Богдана Хмельницкого", "ул. Кирова", "ул. Никитина", "ул. Ватутина", "ул. Станиславского", "ул. Титова", "ул. Ильича", "Морской проспект", "ул. Русская", "ул. Иванова", "ул. Жемчужная", "ул. Часовая", "ул. Геодезическая", "ул. Немировича-Данченко", "ул. Сибиряков-Гвардейцев", "ул. Петухова"];
const PLACES = ["Новосибирск, Центральный район", "Новосибирск, Железнодорожный район", "Новосибирск, Заельцовский район", "Новосибирск, Ленинский район", "Новосибирск, Октябрьский район", "Новосибирск, Кировский район", "Новосибирск, Калининский район", "Новосибирск, Дзержинский район", "Новосибирск, Первомайский район", "Новосибирск, Советский район (Академгородок)", "Бердск", "Обь", "Кольцово"];
const NEED_TYPES: Array<{ propertyType: string; purpose: string; op: string }> = [
  { propertyType: "office", purpose: "Офис", op: "rent" },
  { propertyType: "warehouse", purpose: "Склад", op: "rent" },
  { propertyType: "retail", purpose: "Торговля", op: "rent" },
  { propertyType: "flat", purpose: "Квартира", op: "sale" },
  { propertyType: "house", purpose: "Дом", op: "sale" },
  { propertyType: "office", purpose: "Офис", op: "sale" },
  { propertyType: "flat", purpose: "Квартира", op: "rent" },
  { propertyType: "commercial_premises", purpose: "Помещение", op: "rent" },
];
const STOP_REASONS = ["no_longer_relevant", "chose_other", "budget", "client_refused"];
const POSTDEAL_SUBTYPES = ["invoice", "acceptance_act", "tax_declaration", "rent_indexation", "followup", "other"];
const CHANNELS = ["phone", "website", "messenger", "visit"];
const SOURCES = ["cian", "avito", "referral", "website", "yandex"];

async function main() {
  const users = await db.user.findMany({ where: { login: { in: ["manager", "realtor1", "realtor2"] } } });
  const actor = (login: string): Actor => {
    const u = users.find((x) => x.login === login);
    if (!u || !u.isActive) throw new Error(`seed-realistic: нет активного пользователя ${login} (сначала prisma db seed)`);
    return { userId: u.id, login: u.login, displayName: u.displayName, role: u.roleCode as Actor["role"], mustChangePassword: u.mustChangePassword, sessionId: qaId(`session:${login}`) };
  };
  const manager = actor("manager"), agents = [actor("realtor1"), actor("realtor2")];
  const base = new Date();
  const legalEntity = await db.legalEntity.findFirstOrThrow({ where: { isActive: true }, orderBy: { id: "asc" } });

  // ── Клиенты: 120 (80 физлиц + 40 компаний) ──
  const clientIds: string[] = [];
  for (let i = 0; i < 120; i++) {
    const id = qaId(`client:${i}`);
    const isOrg = i >= 80;
    const owner = agents[i % 2]!;
    let displayName: string, kind: string;
    if (isOrg) {
      const form = i % 10 === 0 ? COMPANY_FORMS[2]! : i % 3 === 0 ? COMPANY_FORMS[1]! : COMPANY_FORMS[0]!;
      const name = form === "ИП" ? `ИП ${SURNAMES_M[i % 20]} ${NAMES_M[i % 20]}` : `${form} «${COMPANIES[(i - 80) % COMPANIES.length]}-${Math.floor((i - 80) / COMPANIES.length) + 1}»`;
      displayName = name; kind = "organization";
    } else {
      const female = i % 2 === 1;
      displayName = `${female ? SURNAMES_F[i % 20] : SURNAMES_M[i % 20]} ${female ? NAMES_F[(i * 3) % 20] : NAMES_M[(i * 3) % 20]} ${female ? MID_F[(i * 7) % 10] : MID_M[(i * 7) % 10]}`;
      kind = "person";
    }
    await db.client.upsert({
      where: { id },
      update: { displayName, responsibleUserId: owner.userId },
      create: { id, displayName, clientKind: kind, responsibleUserId: owner.userId, createdBy: owner.userId, status: i % 29 === 0 ? "inactive" : "active", notes: `${MARK} Вымышленный клиент для QA` },
    });
    const phone = `+7 900 000-${String(i).padStart(2, "0")}-${String((i * 7 + 11) % 100).padStart(2, "0")}`;
    const normalized = phone.replace(/\D/g, "").replace(/^8/, "7").replace(/^/, "+");
    if (!await db.clientContact.count({ where: { clientId: id, contactType: "phone" } })) {
      await db.clientContact.create({ data: { id: qaId(`contact:${i}:phone`), clientId: id, contactType: "phone", rawValue: phone, normalizedValue: normalized, isPrimary: true } });
    }
    if (i % 3 === 0 && !await db.clientContact.count({ where: { clientId: id, contactType: "email" } })) {
      await db.clientContact.create({ data: { id: qaId(`contact:${i}:email`), clientId: id, contactType: "email", rawValue: `qa-client${i}@example.ru`, normalizedValue: `qa-client${i}@example.ru` } });
    }
    if (isOrg && i % 2 === 0 && !await db.clientContactPerson.count({ where: { clientId: id } })) {
      const female = i % 2 === 1;
      await db.clientContactPerson.create({ data: { id: qaId(`person:${i}`), clientId: id, fullName: `${female ? SURNAMES_F[(i + 5) % 20] : SURNAMES_M[(i + 5) % 20]} ${female ? NAMES_F[(i + 2) % 20] : NAMES_M[(i + 2) % 20]}`, position: pick(["директор", "менеджер", "бухгалтер"]), notes: MARK, isPrimary: true } });
    }
    clientIds.push(id);
  }

  // ── Потребности: ~130 ──
  const needIds: string[] = [];
  for (let i = 0; i < 130; i++) {
    const id = qaId(`need:${i}`);
    const clientId = clientIds[i % clientIds.length]!;
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const t = NEED_TYPES[i % NEED_TYPES.length]!;
    const mod = i % 20;
    const status = mod < 10 ? "active" : mod < 13 ? "paused" : mod < 17 ? "closed" : "success";
    const rent = t.op === "rent";
    const data: Record<string, unknown> = {
      clientId, responsibleUserId: client.responsibleUserId, operationType: t.op, propertyType: t.propertyType,
      commercialPurpose: ["office", "warehouse", "retail", "commercial_premises"].includes(t.propertyType) ? t.purpose : null,
      budgetMin: rent ? String(30000 + (i % 12) * 10000) : String(2500000 + (i % 15) * 500000),
      budgetMax: rent ? String(120000 + (i % 12) * 20000) : String(6000000 + (i % 15) * 1000000),
      district: PLACES[i % PLACES.length], locationText: PLACES[(i + 3) % PLACES.length],
      areaMin: t.propertyType === "flat" ? 30 + (i % 5) * 8 : 50 + (i % 10) * 30,
      areaMax: t.propertyType === "flat" ? 90 + (i % 5) * 10 : 500 + (i % 10) * 100,
      stage: status === "success" ? "deal" : "selection",
      status, notes: status === "success" ? `${MARK} Результат достигнут: условия согласованы, договор подписан` : `${MARK} Потребность: ${t.purpose}, ${rent ? "аренда" : "покупка"}`,
      stopReasonCode: status === "closed" ? STOP_REASONS[i % STOP_REASONS.length] : null,
      closedAt: ["closed", "success"].includes(status) ? day(base, -(i % 25) - 1) : null,
      openedAt: day(base, -60 + (i % 55)), createdBy: client.responsibleUserId,
    };
    await db.clientNeed.upsert({ where: { id }, update: data as never, create: { id, ...data } as never });
    if (status === "closed" && !await db.needStageHistory.count({ where: { clientNeedId: id } })) {
      await db.needStageHistory.create({ data: { id: qaId(`stage:${i}`), clientNeedId: id, fromStage: "selection", toStage: "deal", changedBy: client.responsibleUserId, comment: `${MARK} Закрыта: причина указана` } });
    }
    // Инвариант следующего действия
    const needTaskType = status === "paused" ? "pause_return" : "call_or_contact";
    const openFilter: Record<string, unknown> = { status: { in: ["planned", "in_progress"] } };
    if (status === "paused") openFilter["taskType"] = "pause_return";
    const hasOpen = await db.taskNeed.count({ where: { clientNeedId: id, task: openFilter as never } });
    if (["active", "paused"].includes(status) && !hasOpen) {
      const due = status === "paused" ? day(base, 4 + (i % 5)) : i % 3 === 0 ? day(base, -(1 + (i % 6))) : i % 3 === 1 ? day(base, 0, 12 + (i % 6)) : day(base, 1 + (i % 9));
      await db.task.create({ data: { id: qaId(`needtask:${i}`), responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId, taskType: needTaskType, title: status === "paused" ? "Вернуться к потребности после паузы" : pick(["Связаться по подбору объекта", "Уточнить бюджет и сроки", "Предложить варианты", "Согласовать показ"]), dueAt: due, status: "planned", priority: i % 7 === 0 ? "high" : "normal", description: MARK, needLinks: { create: { clientNeedId: id } }, clientLinks: { create: { clientId } } } });
    }
    needIds.push(id);
  }

  // ── Объекты: 150 ──
  const propertyIds: string[] = [];
  for (let i = 0; i < 150; i++) {
    const id = qaId(`property:${i}`);
    const t = NEED_TYPES[(i * 3) % NEED_TYPES.length]!;
    const rent = i % 2 === 0;
    const place = PLACES[i % PLACES.length]!;
    const addressText = `${place}, ${STREETS[i % STREETS.length]}, ${1 + (i % 120)}`;
    const area = t.propertyType === "flat" ? 28 + (i % 40) : 40 + (i % 60) * 15;
    const price = rent ? 25000 + (i % 30) * 8000 : 2800000 + (i % 40) * 450000;
    await db.property.upsert({
      where: { id },
      update: { addressText },
      create: {
        id, responsibleUserId: agents[i % 2]!.userId, propertyType: t.propertyType, operationType: rent ? "rent" : "sale",
        sourceType: "agency_listing", addressText, district: place.split(",")[0], area, floor: t.propertyType === "flat" || t.propertyType === "office" ? 1 + (i % 9) : null,
        floorsTotal: t.propertyType === "flat" || t.propertyType === "office" ? 9 + (i % 8) : null,
        roomsCount: t.propertyType === "flat" ? 1 + (i % 3) : null,
        price, commercialPurpose: ["office", "warehouse", "retail", "commercial_premises"].includes(t.propertyType) ? t.purpose : null,
        status: i % 23 === 0 ? "archived" : "active", description: `${MARK} ${t.purpose}, ${rent ? "аренда" : "продажа"}. Вымышленное описание объекта №${i + 1}.`,
        createdBy: agents[i % 2]!.userId,
      },
    });
    // Собственник + грант контактов для части объектов
    if (!await db.propertyOwner.count({ where: { propertyId: id } })) {
      const female = i % 2 === 1;
      const ownerName = `${female ? SURNAMES_F[(i + 3) % 20] : SURNAMES_M[(i + 3) % 20]} ${female ? NAMES_F[(i + 1) % 20] : NAMES_M[(i + 1) % 20]}`;
      await db.propertyOwner.create({ data: { id: qaId(`owner:${i}`), propertyId: id, clientId: clientIds[(i * 5) % clientIds.length]!, comment: `${MARK} Собственник: ${ownerName} (вымышлен)` } });
    }
    if (i % 4 === 0 && !await db.propertyContactGrant.count({ where: { propertyId: id } })) {
      await db.propertyContactGrant.create({ data: { id: qaId(`grant:${i}`), propertyId: id, userId: agents[(i + 1) % 2]!.userId, grantedBy: agents[i % 2]!.userId, comment: `${MARK} Запрос доступа для показа` } });
    }
    propertyIds.push(id);
  }

  // Фото объектов: 2–3 синтетических JPEG на объект (идемпотентно по originalName)
  for (let i = 0; i < propertyIds.length; i++) {
    const propertyId = propertyIds[i]!;
    const actor = agents.find((a) => a.userId === (i % 2 === 0 ? agents[0]!.userId : agents[1]!.userId))!;
    const count = 2 + (i % 2);
    for (let j = 0; j < count; j++) {
      const originalName = `qa-property-${i + 1}-${j + 1}.jpg`;
      if (await db.documentProperty.count({ where: { propertyId, document: { originalName } } })) continue;
      const hue = (i * 37 + j * 53) % 360;
      const svg = `<svg width="960" height="640"><rect width="960" height="640" fill="hsl(${hue},45%,32%)"/><text x="60" y="300" fill="white" font-size="72">Объект ${i + 1}</text><text x="60" y="380" fill="white" font-size="44">QA-СИНТЕТИКА · вид ${j + 1}</text></svg>`;
      const data = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
      const doc = await uploadPropertyMedia(actor, propertyId, new File([new Uint8Array(data)], originalName, { type: "image/jpeg" }), { kind: "photo" });
      await updatePropertyMedia(actor, propertyId, doc.id, { caption: `${MARK} Синтетическое фото: вид ${j + 1}`, sortOrder: j, isCover: j === 0 });
    }
    if (i < 12) {
      const originalName = `qa-property-${i + 1}-desc.txt`;
      if (!await db.documentProperty.count({ where: { propertyId, document: { originalName } } })) {
        const doc = await uploadPropertyMedia(actor, propertyId, new File([`${MARK}\nВЫМЫШЛЕННОЕ ТЕХНИЧЕСКОЕ ОПИСАНИЕ объекта ${i + 1}.`], originalName, { type: "text/plain" }), { kind: "document", documentTypeCode: "other" });
        await updatePropertyMedia(actor, propertyId, doc.id, { caption: `${MARK} Техническое описание`, sortOrder: 20 });
      }
    }
  }

  // ── Обращения (LeadRequest): ~140 ──
  for (let i = 0; i < 140; i++) {
    const id = qaId(`request:${i}`);
    const clientId = clientIds[i % clientIds.length]!;
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const data = {
      clientId, clientNeedId: needIds[i % needIds.length], propertyId: i % 5 === 0 ? propertyIds[i % propertyIds.length] : null,
      responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId,
      occurredAt: day(base, -(i % 45), 9 + (i % 10)), channelCode: CHANNELS[i % CHANNELS.length],
      sourceCode: SOURCES[i % SOURCES.length], resultCode: ["new_need", "linked_existing_need", "one_off_service", "no_followup"][i % 4],
      statusCode: i % 9 === 0 ? "open" : "processed", summary: `${MARK} Обращение ${i + 1}: ${pick(["звонок по объявлению", "заявка с сайта", "повторный звонок", "визит в офис"])}`,
    };
    await db.leadRequest.upsert({ where: { id }, update: data as never, create: { id, ...data } as never });
    if (i % 4 === 0) {
      const cid = qaId(`comm:${i}`);
      if (!await db.communication.count({ where: { id: cid } })) {
        await db.communication.create({ data: { id: cid, clientId, clientNeedId: needIds[i % needIds.length], leadRequestId: id, authorUserId: client.responsibleUserId, communicationType: "call", channelCode: "phone", occurredAt: day(base, -(i % 45), 10 + (i % 8)), resultCode: pick(["completed", "no_answer", "followup_required"]), comment: `${MARK} Вымышленный звонок ${i + 1}` } });
      }
    }
  }

  // ── Подборы (NeedPropertyMatch) + показы ──
  for (let i = 0; i < 90; i++) {
    const id = qaId(`match:${i}`);
    const needId = needIds[(i * 2) % needIds.length]!;
    const propertyId = propertyIds[(i * 3 + 1) % propertyIds.length]!;
    if (!await db.needPropertyMatch.count({ where: { id } })) {
      const need = await db.clientNeed.findUniqueOrThrow({ where: { id: needId } });
      await db.needPropertyMatch.create({ data: { id, clientNeedId: needId, propertyId, sourceCode: "manual", status: (["proposed", "interested", "showing_planned", "rejected"] as const)[i % 4] as string, comment: `${MARK} Подбор ${i + 1}`, createdBy: need.responsibleUserId } });
    }
  }
  for (let i = 0; i < 60; i++) {
    const id = qaId(`showing:${i}`);
    const needId = needIds[i % needIds.length]!;
    const need = await db.clientNeed.findUniqueOrThrow({ where: { id: needId } });
    const past = i % 2 === 0;
    await db.showing.upsert({
      where: { id },
      update: { scheduledAt: day(base, past ? -(1 + (i % 12)) : 1 + (i % 10), 11 + (i % 8)) },
      create: {
        id, clientNeedId: needId, propertyId: propertyIds[(i * 2 + 1) % propertyIds.length]!, responsibleUserId: need.responsibleUserId, createdBy: need.responsibleUserId,
        scheduledAt: day(base, past ? -(1 + (i % 12)) : 1 + (i % 10), 11 + (i % 8)),
        occurredAt: past ? day(base, -(1 + (i % 12)), 12 + (i % 7)) : null,
        status: past ? "completed" : "planned", resultCode: past ? ["interested", "thinking", "other"][i % 3] : null,
      },
    });
  }

  // ── Задачи: ~170 (просрочки / сегодня / будущее / повторения) ──
  const taskTitles = ["Перезвонить клиенту", "Подготовить подборку", "Согласовать время показа", "Запросить документы", "Проверить объявление", "Напомнить о встрече", "Обновить статус сделки", "Подготовить договор"];
  for (let i = 0; i < 170; i++) {
    const id = qaId(`task:${i}`);
    const owner = i % 11 === 0 ? manager : agents[i % 2]!;
    const bucket = i % 10;
    const due = bucket < 3 ? day(base, -(1 + (i % 8)), 10 + (i % 8)) : bucket < 5 ? day(base, 0, 10 + (i % 9)) : day(base, 1 + (i % 14), 10 + (i % 8));
    const status = bucket === 0 && i % 3 === 0 ? "completed" : "planned";
    const repeating = i % 12 === 0;
    const data = {
      responsibleUserId: owner.userId, createdBy: owner.userId, taskType: pick(["call_or_contact", "showing_or_meeting", "document", "other", "postdeal"]),
      title: `${taskTitles[i % taskTitles.length]} (QA ${i + 1})`, dueAt: due, status, priority: i % 6 === 0 ? "high" : "normal",
      recurrenceKind: repeating ? "weekly" : "none", recurrenceInterval: repeating ? 1 : 1, recurrenceUntil: repeating ? day(base, 60) : null,
      completedAt: status === "completed" ? day(base, -(i % 5)) : null, description: MARK,
    };
    const existing = await db.task.findUnique({ where: { id } });
    if (!existing) {
      const createData: Record<string, unknown> = {
        id, ...data,
        clientLinks: { create: { clientId: clientIds[i % clientIds.length]! } },
      };
      if (i % 3 === 0) createData["needLinks"] = { create: { clientNeedId: needIds[i % needIds.length]! } };
      if (i % 5 === 0) createData["propertyLinks"] = { create: { propertyId: propertyIds[i % propertyIds.length]! } };
      await db.task.create({ data: createData as never });
    } else {
      await db.task.update({ where: { id }, data: { dueAt: due, status } });
    }
  }

  // ── Подборки (SearchSelection) + КП ──
  const storage = getStorage();
  for (let i = 0; i < 12; i++) {
    const needId = needIds[i * 3 % needIds.length]!;
    const need = await db.clientNeed.findUniqueOrThrow({ where: { id: needId } });
    const propertyId = propertyIds[(i * 7) % propertyIds.length]!;
    void propertyId;
    const offerId = qaId(`offer:${i}`);
    let offer = await db.commercialOffer.findUnique({ where: { id: offerId } });
    if (!offer) {
      offer = await db.commercialOffer.create({
        data: {
          id: offerId, clientNeedId: needId, responsibleUserId: need.responsibleUserId, createdBy: need.responsibleUserId,
          legalEntityId: legalEntity.id, status: i % 3 === 0 ? "sent" : i % 3 === 1 ? "prepared" : "draft",
          title: `КП QA-${i + 1}: ${pick(["офис", "склад", "торговое помещение", "квартира"])}`, introText: "Вымышленное коммерческое предложение для QA.",
          expiresAt: day(base, 14 + (i % 10)), sentAt: i % 3 === 0 ? day(base, -1) : null,
          items: { create: [0, 1, 2].map((k) => { const p = propertyIds[(i * 7 + k * 5) % propertyIds.length]!; return { id: qaId(`offeritem:${i}:${k}`), propertyId: p, position: k + 1, comment: `${MARK} Позиция ${k + 1}` }; }) },
        },
      });
    }
    // DOCX/PDF артефакты КП
    for (const ext of ["pdf", "docx"]) {
      const originalName = `qa-kp-${i + 1}.${ext}`;
      if (!await db.document.count({ where: { originalName } })) {
        const buf = Buffer.from(`${MARK}\nВЫМЫШЛЕННОЕ КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ QA-${i + 1} (${ext.toUpperCase()}). Не является юридическим документом.`);
        const stored = await storage.put(buf, { prefix: "qa/offers" });
        const doc = await db.document.create({ data: { id: qaId(`doc:offer:${i}:${ext}`), originalName, documentTypeCode: "commercial_offer", mimeType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileSize: BigInt(buf.length), storageKey: stored.storageKey, checksum: stored.sha256, uploadedBy: need.responsibleUserId, legalEntityId: legalEntity.id } });
        await db.documentCommercialOffer.create({ data: { document: { connect: { id: doc.id } }, offer: { connect: { id: offer.id } } } });
      }
    }
  }

  // ── Сделки с комиссиями + постсделочные задачи ──
  for (let i = 0; i < 8; i++) {
    const id = qaId(`deal:${i}`);
    const propertyId = propertyIds[i * 4 % propertyIds.length]!;
    const property = await db.property.findUniqueOrThrow({ where: { id: propertyId } });
    const clientId = clientIds[i * 3 % clientIds.length]!;
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const completed = i >= 5;
    const existing = await db.deal.findUnique({ where: { id } });
    if (!existing) {
      await db.deal.create({
        data: {
          id, propertyId, legalEntityId: legalEntity.id, responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId,
          status: completed ? "completed" : ["preliminary_agreement", "documents", "registration"][i % 3]!, openedAt: day(base, -40 - i * 3),
          mainAgreementAt: completed ? day(base, -10) : null, closedAt: completed ? day(base, -5) : null,
          dealPrice: property.price, notes: `${MARK} ${property.operationType === "rent" ? "Аренда" : "Продажа"}: сделка QA-${i + 1}`,
          parties: { create: [{ id: qaId(`party:${i}:0`), clientId, partyRole: property.operationType === "rent" ? "tenant" : "buyer" }, { id: qaId(`party:${i}:1`), externalPartyName: `ООО «Вымышленный Собственник ${i + 1}»`, partyRole: property.operationType === "rent" ? "landlord" : "seller" }] },
          commissions: { create: [0, 1].map((j) => ({ id: qaId(`commission:${i}:${j}`), payerPartyId: qaId(`party:${i}:${j}`), amount: property.operationType === "rent" ? "45000.00" : "180000.00", status: completed && j === 0 ? "received" : "due", dueAt: day(base, completed ? -5 : 5 + j), receivedAt: completed && j === 0 ? day(base, -5) : null, comment: `${MARK} Комиссия ${j + 1}` })) },
        },
      });
    }
    if (completed) {
      for (let j = 0; j < 3; j++) {
        const tid = qaId(`postdeal:${i}:${j}`);
        if (!await db.task.count({ where: { id: tid } })) {
          await db.task.create({ data: { id: tid, responsibleUserId: client.responsibleUserId, createdBy: manager.userId, taskType: "postdeal", taskSubtypeCode: POSTDEAL_SUBTYPES[(i + j) % POSTDEAL_SUBTYPES.length], title: `Постсделочная задача QA-${i + 1}.${j + 1}`, dueAt: day(base, j === 2 ? -1 : 3 + j * 4), status: "planned", priority: "normal", description: MARK, dealLinks: { create: { dealId: id } }, clientLinks: { create: { clientId } } } });
        }
      }
    }
  }

  // ── Договоры + документы (PDF/DOCX синтетика) ──
  for (let i = 0; i < 14; i++) {
    const id = qaId(`agreement:${i}`);
    const clientId = clientIds[(i * 7) % clientIds.length]!;
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const dealId = i < 6 ? qaId(`deal:${i % 8}`) : null;
    await db.agreement.upsert({
      where: { id },
      update: {},
      create: {
        id, clientId, propertyId: propertyIds[(i * 5) % propertyIds.length], dealId, responsibleUserId: client.responsibleUserId, legalEntityId: legalEntity.id,
        agreementType: i % 2 ? "lease_related" : "sale_related", status: i % 4 === 3 ? "draft" : "signed",
        agreementNumber: `QA-${2026}-${String(i + 1).padStart(3, "0")}`, signedAt: day(base, -20 - i), validFrom: day(base, -20 - i),
        validUntil: day(base, i % 4 === 0 ? -2 : 30 + i * 5), notes: `${MARK} Вымышленный договор QA-${i + 1}${i === 0 ? "; допсоглашение приложено" : ""}`,
      },
    });
    if (i === 0 && !await db.agreement.count({ where: { id: qaId("agreement:0:addendum") } })) {
      await db.agreement.create({ data: { id: qaId("agreement:0:addendum"), clientId, propertyId: propertyIds[0], dealId: qaId("deal:0"), responsibleUserId: client.responsibleUserId, legalEntityId: legalEntity.id, agreementType: "other", status: "signed", agreementNumber: `QA-2026-001/ДС-1`, signedAt: day(base, -10), validFrom: day(base, -10), validUntil: day(base, 60), notes: `${MARK} Допсоглашение (вымышлено)` } });
    }
    for (const ext of i % 2 === 0 ? ["pdf", "docx"] : ["pdf"]) {
      const originalName = `qa-dogovor-${i + 1}.${ext}`;
      if (!await db.document.count({ where: { originalName } })) {
        const buf = Buffer.from(`${MARK}\nВЫМЫШЛЕННЫЙ ДОГОВОР QA-${i + 1} (${ext.toUpperCase()}). Учебный материал, юридической силы не имеет.`);
        const stored = await storage.put(buf, { prefix: "qa/agreements" });
        const doc = await db.document.create({ data: { id: qaId(`doc:agr:${i}:${ext}`), originalName, documentTypeCode: "agreement", mimeType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileSize: BigInt(buf.length), storageKey: stored.storageKey, checksum: stored.sha256, uploadedBy: client.responsibleUserId, legalEntityId: legalEntity.id } });
        await db.documentAgreement.create({ data: { document: { connect: { id: doc.id } }, agreement: { connect: { id } } } });
      }
    }
    if (i % 5 === 0) await db.agreement.updateMany({ where: { id }, data: { archivedAt: day(base, -1) } });
  }

  // ── Реклама: 25, часть с истекающими сроками ──
  for (let i = 0; i < 25; i++) {
    const id = qaId(`ad:${i}`);
    const propertyId = propertyIds[(i * 6) % propertyIds.length]!;
    const expiring = i % 4 === 0;
    await db.advertisement.upsert({
      where: { id },
      update: { expiresAt: expiring ? day(base, 1 + (i % 5)) : day(base, 20 + i * 3) },
      create: {
        id, propertyId, responsibleUserId: agents[i % 2]!.userId, platformCode: ["cian", "avito", "yandex", "domclick"][i % 4]!,
        url: `https://example.ru/ads/qa-${i + 1}`, adText: `${MARK} Вымышленное объявление QA-${i + 1}: ${pick(["светлый офис", "тёплый склад", "торговое помещение", "уютная квартира"])} в ${PLACES[i % PLACES.length]}.`,
        status: i % 6 === 0 ? "paused" : "active", publishedAt: day(base, -(i % 20)), lastCheckedAt: day(base, -(i % 3)),
        expiresAt: expiring ? day(base, 1 + (i % 5)) : day(base, 20 + i * 3),
      },
    });
  }

  // ── Исторический архив: 30 ──
  for (let i = 0; i < 30; i++) {
    const key = `qa-v323-row-${i + 1}`;
    await db.historicalDealArchive.upsert({
      where: { sourceRowKey: key },
      update: {},
      create: {
        sourceFile: "synthetic-qa.xlsx", sourceRowKey: key, sourceRowId: String(i + 1), dealDate: day(base, -400 - i * 11),
        participantName: `${SURNAMES_M[(i * 3) % 20]} ${NAMES_M[(i * 5) % 20]}`, contactPhone: `+7 900 000-90-${String(i).padStart(2, "0")}`,
        propertyType: NEED_TYPES[i % NEED_TYPES.length]!.propertyType, objectText: `Вымышленный объект архива №${i + 1}, ${PLACES[i % PLACES.length]}`,
        area: 40 + i * 7, price: 3000000 + i * 250000, realtorText: `Риелтор ${1 + (i % 2)} (архив)`, commissionAmount: 90000 + i * 1000,
        additionalInfo: `${MARK} Синтетическая историческая запись`,
      },
    });
  }

  await db.notificationPreference.createMany({ data: users.map((u) => ({ userId: u.id })), skipDuplicates: true });
  await generateNotifications(new Date());

  const counts = {
    clients: await db.client.count(), needs: await db.clientNeed.count(), properties: await db.property.count(),
    requests: await db.leadRequest.count(), showings: await db.showing.count(), tasks: await db.task.count(),
    offers: await db.commercialOffer.count(), deals: await db.deal.count(), agreements: await db.agreement.count(),
    ads: await db.advertisement.count(), archive: await db.historicalDealArchive.count(), docs: await db.document.count(),
  };
  console.log(`seed-realistic done ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error("seed-realistic failed:", e instanceof Error ? e.message.split("\n").slice(-2).join(" ") : e); process.exitCode = 1; }).finally(() => disconnectDb());
