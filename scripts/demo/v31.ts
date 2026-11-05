import { readFile } from "node:fs/promises";
import { db, demoId, day, type DemoContext } from "./context";
import { saveTemplate, generateFromTemplate } from "@/modules/document-templates/application/template-service";
import { taskProposal } from "@/modules/ai-chat/domain/policy";

/** Synthetic, deterministic fixtures only. Never calls a cloud provider. */
export async function seedV31(ctx: DemoContext) {
  const anchor = new Date("2026-11-05T05:00:00Z");
  for (let i = 0; i < 72; i++) {
    const owner = ctx.agents[i % 2]!;
    const dueAt = day(anchor, i < 8 ? 0 : i - 8, 9 + i % 9);
    const data = { title: ["Уточнить условия аренды", "Подготовить подборку", "Согласовать показ", "Проверить документы", "Повторный контакт", "Контроль договора"][i % 6]!, description: "DEMO v3.1 · синтетический рабочий план", dueAt,
      taskType: i % 6 === 5 ? "contract_check" : "call_or_contact", status: i % 11 === 0 ? "completed" : "planned", priority: ["high", "normal", "low"][i % 3]!, responsibleUserId: owner.userId, createdBy: owner.userId,
      ...(i % 11 === 0 ? { completedAt: dueAt, resultComment: "DEMO · Контроль выполнен" } : {}),
      ...(i === 5 ? { recurrenceKind: "monthly", recurrenceInterval: 3, recurrenceUntil: new Date("2027-11-05") } : {}) };
    await db.task.upsert({ where: { id: demoId(`v31:task:${i}`) }, update: {}, create: { id: demoId(`v31:task:${i}`), ...data, clientLinks: { create: { clientId: ctx.clients[i % 25]!.id } } } });
  }
  for (let i = 0; i < 4; i++) await db.taskChecklistItem.upsert({ where: { id: demoId(`v31:check:${i}`) }, update: {}, create: {
    id: demoId(`v31:check:${i}`), taskId: demoId("v31:task:1"), title: ["Уточнить бюджет и район", "Проверить актуальность объектов", "Согласовать время просмотра", "Отправить подборку клиенту"][i]!, sortOrder: i, required: i < 3,
    status: i === 0 ? "done" : "open", dueAt: day(anchor, i - 2, 10), responsibleUserId: ctx.agents[1]!.userId,
    ...(i === 0 ? { completedAt: day(anchor, -1), completedBy: ctx.agents[1]!.userId, result: "Бюджет и пожелания подтверждены" } : {}),
  } });
  for (let i = 0; i < 16; i++) await db.leadRequest.upsert({ where: { id: demoId(`v31:call:${i}`) }, update: {}, create: {
    id: demoId(`v31:call:${i}`), occurredAt: day(anchor, -i % 5, 9 + i % 9), channelCode: "phone", sourceCode: ["cian", "avito", "referral", "website"][i % 4]!, resultCode: ["invalid_or_spam", "one_off_service", "invalid_or_spam", "linked_existing_need"][i % 4]!, outcomeCode: ["spam", "one_time", "wrong", "prospective"][i % 4]!,
    statusCode: "processed", summary: ["DEMO · Рекламный звонок, спам", "DEMO · Разовая консультация по стоимости", "DEMO · Ошибочный номер, продолжение не требуется", "DEMO · Уточнение условий подбора, следующий контакт назначен"][i % 4]!,
    responsibleUserId: ctx.agents[0]!.userId, createdBy: ctx.agents[0]!.userId, ...(i % 4 === 3 ? { clientId: ctx.clients[0]!.id, clientNeedId: ctx.needs[0]!.id } : {}),
  } });
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
    await generateFromTemplate(ctx.manager, template!.id, { entityKind: format === "docx" || format === "xlsx" ? "collection" : "client", entityId: format === "docx" || format === "xlsx" ? demoId("v31:collection:1") : ctx.clients[0]!.id, requestId: demoId(`v31:document:${format}`) });
  }
  const sessionId = demoId("v31:chat"), actionId = demoId("v31:chat:action");
  await db.aiChatSession.upsert({ where: { id: sessionId }, update: {}, create: { id: sessionId, ownerUserId: ctx.agents[0]!.userId, title: "DEMO · Следующий контакт", contextType: "client", contextId: ctx.clients[0]!.id } });
  // Recorded response of the deterministic DEMO provider; no Yandex request or usage claim.
  const payload = taskProposal.parse({ clientId: ctx.clients[0]!.id, title: "Уточнить обратную связь по подборке", dueAt: day(anchor, 1, 11).toISOString(), description: "DEMO · Согласовать варианты и время показа. Задача появится только после подтверждения." });
  await db.aiPendingAction.upsert({ where: { id: actionId }, update: {}, create: { id: actionId, sessionId, actionType: "task", payload } });
  for (const [index, role, content] of [[0, "user", "Подготовь черновик задачи: завтра в 11:00 уточнить обратную связь по подборке."], [1, "assistant", "DEMO-провайдер (локальная синтетическая запись, без обращения к Yandex AI). Подготовлен черновик задачи. Проверьте срок и описание; сохранение произойдёт только после нажатия «Подтвердить»."]] as const)
    await db.aiChatMessage.upsert({ where: { id: demoId(`v31:chat:message:${index}`) }, update: {}, create: { id: demoId(`v31:chat:message:${index}`), sessionId, role, content, createdAt: new Date(+anchor + index * 1000) } });
}
