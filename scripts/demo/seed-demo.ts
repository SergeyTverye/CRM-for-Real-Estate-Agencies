import { db, marker, demoId, day, printCounts, type DemoContext } from "./context";
import type { Actor } from "@/modules/auth/domain/actor";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { seedMediaAndOffers, seedDeals, seedGallery } from "./transactions";
import { seedSearchAndCosts } from "./search";
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
import { readNotification } from "@/modules/notifications/application/notification-service";
import { seedDemoIssuers } from "./issuer";
import { seedV31 } from "./v31";

const districts = ["Центральный", "Железнодорожный", "Заельцовский", "Ленинский", "Октябрьский", "Кировский", "Калининский", "Дзержинский", "Первомайский", "Советский"];
const types = ["retail", "commercial_premises", "office", "warehouse", "production"];
const first = ["Александр", "Мария", "Дмитрий", "Елена", "Сергей", "Ольга", "Павел", "Анна", "Илья", "Наталья", "Максим", "Ирина", "Андрей", "Татьяна", "Роман", "Юлия", "Виктор", "Светлана", "Евгений", "Дарья", "Михаил", "Вера", "Константин", "Людмила", "Григорий"];
const last = ["Орлов", "Соколова", "Крылов", "Миронова", "Лебедев", "Волкова", "Зайцев", "Фомина", "Белов", "Котова", "Ершов", "Романова", "Мельников", "Зуева", "Поляков", "Смирнова", "Комаров", "Гусева", "Никитин", "Кузнецова", "Федоров", "Баранова", "Титов", "Макарова", "Гордеев"];

async function main() {
  const users = await db.user.findMany({ where: { login: { in: ["manager", "realtor1", "realtor2"] } } });
  const actor = (login: string): Actor => {
    const user = users.find(u => u.login === login);
    if (!user || !user.isActive || !["manager", "realtor"].includes(user.roleCode)) throw new Error("Run ordinary seed first: active manager/realtor1/realtor2 required");
    return { userId: user.id, login, displayName: user.displayName, role: user.roleCode as Actor["role"], mustChangePassword: user.mustChangePassword, sessionId: demoId(`session:${login}`) };
  };
  const origin = (await db.client.findFirst({ where: { notes: { contains: marker } }, orderBy: { createdAt: "asc" } }))?.createdAt ?? new Date();
  const ctx: DemoContext = { agents: [actor("realtor1"), actor("realtor2")], manager: actor("manager"), origin, clients: [], needs: [], properties: [] };
  for (let i = 0; i < 25; i++) {
    const owner = ctx.agents[i % 2]!;
    const person = `${last[i]} ${first[i]}`;
    const displayName = i % 3 === 0 ? `ООО «Сибирь Коммерция ${i + 1}»` : i % 3 === 1 ? `ИП ${person}` : person;
    const client = await db.client.findFirst({ where: { displayName, notes: { contains: marker } } }) ?? await db.client.create({ data: {
      id: demoId(`client:${i}`), displayName, clientKind: i % 3 === 0 ? "organization" : "person", responsibleUserId: owner.userId,
      createdBy: owner.userId, status: "active", notes: `${marker} Синтетическая демонстрационная запись`,
    } });
    ctx.clients.push(client);
    const suffix = String(i + 1).padStart(2, "0");
    for (const [contactType, rawValue, normalizedValue] of [["phone", `+7 900 000-${suffix}-${suffix}`, `+7900000${suffix}${suffix}`], ["email", `client${i + 1}@example.ru`, `client${i + 1}@example.ru`]]) {
      if (!await db.clientContact.count({ where: { clientId: client.id, contactType, normalizedValue } })) await db.clientContact.create({ data: { id: demoId(`contact:${i}:${contactType}`), clientId: client.id, contactType: contactType!, rawValue: rawValue!, normalizedValue, isPrimary: contactType === "phone" } });
    }
  }
  for (let i = 0; i < 30; i++) {
    const owner = ctx.agents[i % 2]!;
    const addressText = `Новосибирск, ${districts[i % 10]} район, деловой квартал, дом ${10 + i}`;
    const property = await db.property.findFirst({ where: { addressText, description: { contains: "Синтетическая демонстрационная карточка" } } }) ?? await db.property.create({ data: {
      id: demoId(`property:${i}`), responsibleUserId: owner.userId, propertyType: types[i % 5]!, operationType: i % 2 ? "rent" : "sale", sourceType: "agency_listing", addressText,
      district: districts[i % 10], area: 80 + i * 17, floor: i % 8 + 1, floorsTotal: 8,
      price: i % 2 ? 65000 + i * 5000 : 12000000 + i * 850000, status: "active", description: `Коммерческое помещение. Синтетическая демонстрационная карточка №${i + 1}.`, createdBy: owner.userId,
    } });
    ctx.properties.push(property);
  }
  for (let i = 0; i < 25; i++) {
    const owner = ctx.agents[i % 2]!, client = ctx.clients[i]!;
    const status = ["active", "paused", "closed", "success"][i % 4]!;
    const need = await db.$transaction(async tx => {
      const need = await tx.clientNeed.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }) ?? await tx.clientNeed.create({ data: {
        id: demoId(`need:${i}`), clientId: client.id, responsibleUserId: owner.userId, operationType: i % 2 ? "rent" : "sale", propertyType: types[i % 5]!,
        budgetMin: i % 2 ? "50000" : "5000000", budgetMax: i % 2 ? "250000" : "50000000", district: districts[i % 10], areaMin: 60, areaMax: 500,
        stage: status === "success" ? "deal" : "selection", status, stopReasonCode: status === "closed" ? "no_longer_relevant" : undefined,
        closedAt: ["closed", "success"].includes(status) ? day(origin, -i - 1) : undefined,
        notes: status === "success" ? `${marker} Результат достигнут: аренда оформлена, условия согласованы` : marker, createdBy: owner.userId,
      } });
      if (need.status === "success" && !need.notes) await tx.clientNeed.update({ where: { id: need.id }, data: { notes: `${marker} Результат достигнут: условия согласованы` } });
      if (["active", "paused"].includes(need.status) && !await tx.taskNeed.count({ where: { clientNeedId: need.id, task: { status: { in: ["planned", "in_progress"] }, ...(need.status === "paused" ? { taskType: "pause_return" } : {}) } } })) {
        await tx.task.create({ data: { id: demoId(`next:${i}`), responsibleUserId: owner.userId, createdBy: owner.userId,
          taskType: need.status === "paused" ? "pause_return" : "call_or_contact", title: need.status === "paused" ? "Вернуться к потребности после паузы" : "Связаться по подбору объекта",
          dueAt: day(origin, need.status === "paused" ? 4 : i % 3 === 0 ? -2 : 0, 9 + i % 10), status: "planned", priority: i % 5 === 0 ? "high" : "normal",
          needLinks: { create: { clientNeedId: need.id } }, clientLinks: { create: { clientId: client.id } },
        } });
      }
      await assertNeedInvariants(tx, [need.id]);
      return need;
    });
    ctx.needs.push(need);
  }
  for (let i = 0; i < 35; i++) {
    const summary = `Демо обращение ${i + 1}; ответственный агент: ${i % 2 + 1}.`;
    if (await db.leadRequest.count({ where: { summary, clientId: ctx.clients[i % 25]!.id } })) {
      await db.leadRequest.updateMany({ where: { summary, clientId: ctx.clients[i % 25]!.id }, data: { occurredAt: day(origin, -i, 9 + i % 10) } });
      continue;
    }
    const client = ctx.clients[i % 25]!;
    await db.leadRequest.create({ data: { id: demoId(`request:${i}`), clientId: client.id, responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId,
      occurredAt: day(origin, -i, 9 + i % 10), channelCode: ["phone", "website", "messenger"][i % 3]!, sourceCode: ["cian", "avito", "referral", "website"][i % 4]!,
      resultCode: ["new_need", "linked_existing_need", "one_off_service", "no_followup"][i % 4]!, statusCode: i % 6 === 0 ? "open" : "processed", summary,
    } });
  }
  for (const i of [2, 6]) await db.leadRequest.upsert({ where: { id: demoId(`missing-next:${i}`) }, update: {}, create: {
    id: demoId(`missing-next:${i}`), clientId: ctx.clients[i]!.id, responsibleUserId: ctx.clients[i]!.responsibleUserId, createdBy: ctx.manager.userId,
    occurredAt: day(origin, -3), channelCode: "phone", sourceCode: "website", resultCode: "new_need", statusCode: "open", summary: `${marker} Перспективное обращение без следующего действия (контроль исключений)`,
  } });
  for (let i = 0; i < 8; i++) {
    const propertyId = ctx.properties[i]!.id, clientNeedId = ctx.needs[i]!.id;
    if (!await db.showing.count({ where: { propertyId, clientNeedId } })) await db.showing.create({ data: {
      id: demoId(`showing:${i}`), propertyId, clientNeedId, responsibleUserId: ctx.agents[i % 2]!.userId, createdBy: ctx.agents[i % 2]!.userId,
      scheduledAt: day(origin, i % 2 ? 3 : -3, 10 + i), occurredAt: i % 2 ? null : day(origin, -3, 10 + i), status: i % 2 ? "planned" : "completed", resultCode: i % 2 ? null : "thinking",
    } });
  }
  for (let i = 0; i < 3; i++) {
    const title = i === 2 ? "Личное событие (демо)" : "Встреча по коммерческой недвижимости", ownerUserId = ctx.agents[i % 2]!.userId;
    if (!await db.calendarEvent.count({ where: { title, ownerUserId } })) await db.calendarEvent.create({ data: {
      id: demoId(`event:${i}`), ownerUserId, title, description: "Синтетическое событие для демонстрации календаря", startAt: day(origin, i - 1, 11 + i * 2), endAt: new Date(+day(origin, i - 1, 11 + i * 2) + 3600000), visibility: i === 2 ? "private" : "public", clientId: i === 2 ? null : ctx.clients[i]!.id,
    } });
  }
  for (const i of [0, 4, 8]) {
    const client = ctx.clients[i]!, need = ctx.needs[i]!;
    await db.task.updateMany({ where: { needLinks: { some: { clientNeedId: ctx.needs[i]!.id } }, status: { in: ["planned", "in_progress"] }, taskType: { in: ["call_or_contact", "pause_return"] } }, data: { dueAt: day(origin, 1, 10 + i % 8) } });
    const data = { clientId: client.id, clientNeedId: need.id, responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId,
      occurredAt: day(origin, -1, 10 + i % 8), channelCode: "phone", sourceCode: "cian", resultCode: "linked_existing_need", statusCode: "open", summary: `${marker} Уточнить подходящие помещения, следующий звонок назначен` };
    await db.leadRequest.upsert({ where: { id: demoId(`with-action:${i}`) }, update: data, create: { id: demoId(`with-action:${i}`), ...data } });
  }
  for (let i = 0; i < 6; i++) {
    const client = ctx.clients[i]!, dueAt = day(origin, -2, 10 + i);
    const data = { responsibleUserId: client.responsibleUserId, createdBy: client.responsibleUserId, taskType: "call_or_contact",
      priority: "normal", title: i % 2 ? "Уточнить решение по предложению" : "Обсудить условия подбора", status: "completed", dueAt,
      completedAt: new Date(+dueAt + (i % 2 ? 90 : -15) * 60000), description: `${marker} Контроль фактического срока контакта` };
    await db.task.upsert({ where: { id: demoId(`completed-contact:${i}`) }, update: data, create: { id: demoId(`completed-contact:${i}`), ...data, clientLinks: { create: { clientId: client.id } } } });
  }
  for (let i = 0; i < ctx.needs.length; i++) {
    if ([0, 4, 8].includes(i)) continue;
    await db.task.updateMany({ where: { needLinks: { some: { clientNeedId: ctx.needs[i]!.id } }, status: { in: ["planned", "in_progress"] }, taskType: { in: ["call_or_contact", "pause_return"] } }, data: { dueAt: day(origin, ctx.needs[i]!.status === "paused" ? 4 : i % 3 === 0 ? -2 : 0, 9 + i % 10) } });
  }
  for (let i = 0; i < 8; i++) await db.showing.updateMany({ where: { propertyId: ctx.properties[i]!.id, clientNeedId: ctx.needs[i]!.id }, data: { scheduledAt: day(origin, i % 2 ? 3 : -3, 10 + i), occurredAt: i % 2 ? null : day(origin, -3, 10 + i) } });
  for (let i = 0; i < 3; i++) await db.calendarEvent.updateMany({ where: { ownerUserId: ctx.agents[i % 2]!.userId, title: i === 2 ? "Личное событие (демо)" : "Встреча по коммерческой недвижимости" }, data: { startAt: day(origin, i - 1, 11 + i * 2), endAt: new Date(+day(origin, i - 1, 11 + i * 2) + 3600000) } });
  for (const need of ctx.needs) {
    const links = await db.taskNeed.findMany({ where: { clientNeedId: need.id }, select: { taskId: true } });
    await db.taskClient.createMany({ data: links.map(link => ({ taskId: link.taskId, clientId: need.clientId })), skipDuplicates: true });
  }
  await seedDemoIssuers(ctx);
  await seedMediaAndOffers(ctx);
  await seedDeals(ctx);
  await seedSearchAndCosts(ctx);
  await seedV31(ctx);
  const transferred = await db.searchSelection.findFirstOrThrow({ where: { needId: ctx.needs[0]!.id, matchId: { not: null } }, include: { property: true } });
  if (transferred.property) await seedGallery(ctx, [transferred.property], 30);
  await db.notificationPreference.createMany({ data: users.map(u => ({ userId: u.id })), skipDuplicates: true });
  await generateNotifications(new Date());
  for (const agent of ctx.agents) {
    if (await db.notification.count({ where: { recipientUserId: agent.userId, state: "read" } })) continue;
    const notification = await db.notification.findFirst({ where: { recipientUserId: agent.userId, state: "delivered" }, orderBy: { id: "asc" } });
    if (notification) await readNotification(agent, notification.id);
  }
  await assertNeedInvariants(db, ctx.needs.map(n => n.id));
  await printCounts();
}
main().catch((error) => { console.error("Demo seed failed", error instanceof Error ? error.message.split("\n").slice(-2).join(" ").replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]") : "unknown"); process.exitCode = 1; }).finally(() => db.$disconnect());
