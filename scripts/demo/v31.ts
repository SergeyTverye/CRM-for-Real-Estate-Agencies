import { readFile } from "node:fs/promises";
import { db, demoId, day, type DemoContext } from "./context";
import { saveTemplate, generateFromTemplate } from "@/modules/document-templates/application/template-service";
import { taskProposal } from "@/modules/ai-chat/domain/policy";

/** Synthetic, deterministic fixtures only. Never calls a cloud provider. */
export async function seedV31(ctx: DemoContext) {
  const anchor = new Date("2026-11-06T05:00:00Z");
  for (let i = 0; i < 96; i++) {
    const owner = ctx.agents[i % 2]!;
    const dueAt = day(anchor, i === 63 ? 56 : i < 8 ? 0 : Math.min(i - 8, 86), 9 + i % 9);
    const data = { title: ["Уточнить условия аренды", "Подготовить подборку", "Согласовать показ", "Проверить документы", "Повторный контакт", "Контроль договора"][i % 6]!, description: "DEMO v3.1 · синтетический рабочий план", dueAt,
      taskType: i % 6 === 5 ? "contract_check" : "call_or_contact", status: i % 11 === 0 ? "completed" : "planned", priority: ["high", "normal", "low"][i % 3]!, responsibleUserId: owner.userId, createdBy: owner.userId,
      completedAt: i % 11 === 0 ? dueAt : null, resultComment: i % 11 === 0 ? "DEMO · Контроль выполнен" : null,
      recurrenceKind: i === 5 ? "monthly" : i === 6 ? "weekly" : i === 7 ? "yearly" : "none", recurrenceInterval: i === 5 ? 3 : 1,
      recurrenceUntil: [5, 6, 7].includes(i) ? new Date("2027-11-06") : null };
    const taskId = demoId(`v31:task:${i}`);
    await db.task.upsert({ where: { id: taskId }, update: data, create: { id: taskId, ...data } });
    await db.taskClient.createMany({ data: [{ taskId, clientId: ctx.clients[i % 25]!.id }], skipDuplicates: true });
    if (i % 25 === 0) await db.taskNeed.createMany({ data: [{ taskId, clientNeedId: ctx.needs[0]!.id }], skipDuplicates: true });
  }
  for (let i = 0; i < 4; i++) await db.taskChecklistItem.upsert({ where: { id: demoId(`v31:check:${i}`) }, update: {}, create: {
    id: demoId(`v31:check:${i}`), taskId: demoId("v31:task:1"), title: ["Уточнить бюджет и район", "Проверить актуальность объектов", "Согласовать время просмотра", "Отправить подборку клиенту"][i]!, sortOrder: i, required: i < 3,
    status: i === 0 ? "done" : "open", dueAt: day(anchor, i - 2, 10), responsibleUserId: ctx.agents[1]!.userId,
    ...(i === 0 ? { completedAt: day(anchor, -1), completedBy: ctx.agents[1]!.userId, result: "Бюджет и пожелания подтверждены" } : {}),
  } });
  // Checklist examples also live in December and January, not only on the first day.
  for (const taskIndex of [33, 63]) for (let i = 0; i < 3; i++) {
    const id = demoId(`v31:check:${taskIndex}:${i}`);
    await db.taskChecklistItem.upsert({ where: { id }, update: { dueAt: day(anchor, taskIndex === 63 ? 56 : taskIndex - 8, 10 + i) }, create: {
      id, taskId: demoId(`v31:task:${taskIndex}`), title: ["Проверить условия договора", "Согласовать документы", "Назначить следующий контакт"][i]!,
      sortOrder: i, required: i < 2, status: "open", dueAt: day(anchor, taskIndex === 63 ? 56 : taskIndex - 8, 10 + i), responsibleUserId: ctx.agents[taskIndex % 2]!.userId,
    } });
  }
  for (let i = 0; i < 16; i++) {
    const data = {
    id: demoId(`v31:call:${i}`), occurredAt: day(anchor, -i % 5, 9 + i % 9), channelCode: "phone", sourceCode: ["cian", "avito", "referral", "website"][i % 4]!, resultCode: ["invalid_or_spam", "one_off_service", "invalid_or_spam", "linked_existing_need"][i % 4]!, outcomeCode: ["spam", "one_time", "wrong", "prospective"][i % 4]!,
    statusCode: "processed", summary: ["DEMO · Рекламный звонок, спам", "DEMO · Разовая консультация по стоимости", "DEMO · Ошибочный номер, продолжение не требуется", "DEMO · Уточнение условий подбора, следующий контакт назначен"][i % 4]!,
    responsibleUserId: ctx.agents[Math.floor(i / 4) % 2]!.userId, createdBy: ctx.agents[Math.floor(i / 4) % 2]!.userId,
    clientId: i % 4 === 3 ? ctx.clients[0]!.id : null, clientNeedId: i % 4 === 3 ? ctx.needs[0]!.id : null,
  };
    // Cross every outcome with every source rather than making source imply outcome.
    data.sourceCode = ["cian", "avito", "referral", "website"][Math.floor(i / 4)]!;
    await db.leadRequest.upsert({ where: { id: data.id }, update: data, create: data });
  }
  for (let i = 0; i < 2; i++) {
    const collectionId = demoId(`v31:collection:${i}`);
    await db.propertyCollection.upsert({ where: { id: collectionId }, update: {}, create: { id: collectionId, name: i ? "DEMO · Помещения для Сибирь Коммерция" : "DEMO · Офисы в центре — обзор рынка", ownerUserId: ctx.agents[0]!.userId, visibility: "private" } });
    for (let j = 0; j < 3; j++) await db.propertyCollectionItem.upsert({ where: { id: demoId(`v31:item:${i}:${j}`) }, update: {}, create: { id: demoId(`v31:item:${i}:${j}`), collectionId, propertyId: ctx.properties[j * 2]!.id, sortOrder: j, addedBy: ctx.agents[0]!.userId, status: j === 1 ? "check" : "in_collection", comment: ["Удобное расположение, проверить парковку", "Уточнить наличие отдельного входа", "Резервный вариант по бюджету"][j] } });
    if (i) await db.propertyCollectionNeed.upsert({ where: { collectionId_needId: { collectionId, needId: ctx.needs[0]!.id } }, update: {}, create: { collectionId, needId: ctx.needs[0]!.id, linkedBy: ctx.agents[0]!.userId } });
  }
  const formats = ["markdown_docx", "docx", "xlsx", "xlsx_registry"] as const;
  for (const format of formats) {
    const code = `demo_v31_${format}`;
    let template = await db.documentTemplate.findUnique({ where: { code } });
    const manifestYaml = await readFile(`templates/examples/${format === "xlsx_registry" ? "registry" : format === "markdown_docx" ? "client" : "collection"}.yaml`, "utf8");
    const markdownBody = format === "markdown_docx" ? await readFile("templates/examples/client.md", "utf8") : undefined;
    for (let version = (template ? await db.documentTemplateVersion.count({ where: { templateId: template.id } }) : 0) + 1; version <= 2; version++) {
      const file = format === "docx" || format === "xlsx" ? new File([await readFile(`templates/examples/collection.${format}`)], `collection.${format}`) : null;
      const result = await saveTemplate(ctx.manager, { code, name: `DEMO · ${{ markdown_docx: "Карточка клиента", docx: "Подборка DOCX", xlsx: "Подборка XLSX", xlsx_registry: "Реестр клиентов" }[format]}`, format, manifestYaml, markdownBody, description: "Синтетический образец из templates/examples", compatibilityNote: `Версия ${version}: проверка на демонстрационных данных` }, file, template?.id, template?.updatedAt.toISOString());
      template = await db.documentTemplate.findUniqueOrThrow({ where: { id: result.id } });
    }
    const forCollection = format === "docx" || format === "xlsx";
    await generateFromTemplate(forCollection ? ctx.agents[0]! : ctx.manager, template!.id, { entityKind: forCollection ? "collection" : "client", entityId: forCollection ? demoId("v31:collection:1") : ctx.clients[0]!.id, requestId: demoId(`v31:document:${format}`) });
  }
  const sessionId = demoId("v31:chat"), actionId = demoId("v31:chat:action");
  await db.aiChatSession.upsert({ where: { id: sessionId }, update: {}, create: { id: sessionId, ownerUserId: ctx.agents[0]!.userId, title: "DEMO · Следующий контакт", contextType: "client", contextId: ctx.clients[0]!.id } });
  // Recorded response of the deterministic DEMO provider; no Yandex request or usage claim.
  const payload = taskProposal.parse({ clientId: ctx.clients[0]!.id, title: "Уточнить обратную связь по подборке", dueAt: day(anchor, 1, 11).toISOString(), description: "DEMO · Согласовать варианты и время показа. Задача появится только после подтверждения." });
  await db.aiPendingAction.upsert({ where: { id: actionId }, update: {}, create: { id: actionId, sessionId, actionType: "task", payload } });
  for (const [index, role, content] of [[0, "user", "Подготовь черновик задачи: завтра в 11:00 уточнить обратную связь по подборке."], [1, "assistant", "DEMO-провайдер (локальная синтетическая запись, без обращения к Yandex AI). Подготовлен черновик задачи. Проверьте срок и описание; сохранение произойдёт только после нажатия «Подтвердить»."]] as const)
    await db.aiChatMessage.upsert({ where: { id: demoId(`v31:chat:message:${index}`) }, update: {}, create: { id: demoId(`v31:chat:message:${index}`), sessionId, role, content, createdAt: new Date(+anchor + index * 1000) } });
}
