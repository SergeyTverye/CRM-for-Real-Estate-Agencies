import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import { DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import {
  parseInput,
  zCode,
  zDateTime,
  zExpectedUpdatedAt,
  zOptCode,
  zOptDateOnly,
  zOptText,
  zRequiredText,
  zUuid,
} from "@/shared/validation";
import type { Code } from "@/shared/codebook";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import {
  agreementScope,
  clientScope,
  dealScope,
  needScope,
  offerScope,
  showingScope,
  taskScope,
} from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { isOpenTaskStatus, nextRecurrenceDue, OPEN_TASK_STATUSES } from "../domain/task-rules";

/**
 * UC-06 CreateOrCompleteTask (FR-09, FR-10, FR-11, FR-26).
 * Task — единая сущность для задач, звонков, напоминаний, контрольных дат
 * и повторяемых действий. Связи с бизнес-контекстом — нормализованные join-таблицы.
 */

const ids = z.array(zUuid).max(20).default([]);

export const taskLinksSchema = z
  .object({
    clientIds: ids,
    needIds: ids,
    propertyIds: ids,
    showingIds: ids,
    dealIds: ids,
    advertisementIds: ids,
    agreementIds: ids,
    offerIds: ids,
  })
  .partial()
  .default({});

export type TaskLinks = z.infer<typeof taskLinksSchema>;

export const taskInputSchema = z
  .object({
    title: zRequiredText(300, "Укажите, что нужно сделать"),
    description: zOptText(4000),
    taskType: zCode("taskType"),
    taskSubtypeCode: zOptCode("postdealSubtype"),
    dueAt: zDateTime,
    priority: zCode("taskPriority").default("normal"),
    responsibleUserId: zUuid.optional(),
    recurrenceKind: zCode("recurrenceKind").default("none"),
    recurrenceInterval: z.coerce.number().int().min(1).max(365).default(1),
    recurrenceUntil: zOptDateOnly,
    links: taskLinksSchema,
  })
  .superRefine((t, ctx) => {
    if (t.taskType === "postdeal" && !t.taskSubtypeCode)
      ctx.addIssue({ code: "custom", path: ["taskSubtypeCode"], message: "Для постсделочной задачи выберите подвид" });
  });

export type TaskInput = z.infer<typeof taskInputSchema>;

/** Короткая форма «следующего действия» для команд потребности/показа/коммуникации. */
export const nextActionSchema = z.object({
  title: zRequiredText(300, "Опишите следующее действие"),
  description: zOptText(4000),
  taskType: zCode("taskType").default("call_or_contact"),
  dueAt: zDateTime,
  priority: zCode("taskPriority").default("normal"),
  responsibleUserId: zUuid.optional(),
});

export type NextActionInput = z.infer<typeof nextActionSchema>;

/**
 * Ответственный за задачу: руководитель может назначить любого активного сотрудника,
 * риелтор — себя или руководителя (эскалация). Сервер не доверяет user_id из формы без проверки.
 */
export async function resolveTaskResponsible(tx: Tx | typeof db, actor: Actor, requested: string | undefined, fallback: string): Promise<string> {
  const userId = requested ?? fallback;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, roleCode: true } });
  if (!user || !user.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
  if (!isManager(actor) && userId !== actor.userId && userId !== fallback && user.roleCode !== "manager") {
    throw new ValidationError(undefined, { responsibleUserId: ["Риелтор может назначить задачу себе или руководителю"] });
  }
  return userId;
}

async function assertAccessible(count: Promise<number>, expected: number, field: string) {
  if ((await count) !== expected) throw new ValidationError("Связанная запись не найдена или недоступна", { [field]: ["Недоступная запись"] });
}

/** Пользователь не может связать задачу с недоступной ему сущностью (UC-06). */
export async function assertTaskLinksAccessible(tx: Tx | typeof db, actor: Actor, links: TaskLinks): Promise<void> {
  const u = (a?: string[]) => [...new Set(a ?? [])];
  const l = {
    clientIds: u(links.clientIds),
    needIds: u(links.needIds),
    propertyIds: u(links.propertyIds),
    showingIds: u(links.showingIds),
    dealIds: u(links.dealIds),
    advertisementIds: u(links.advertisementIds),
    agreementIds: u(links.agreementIds),
    offerIds: u(links.offerIds),
  };
  // Последовательно: внутри интерактивной транзакции одно соединение, параллельные запросы недопустимы.
  if (l.clientIds.length) await assertAccessible(tx.client.count({ where: { id: { in: l.clientIds }, ...clientScope(actor) } }), l.clientIds.length, "links.clientIds");
  if (l.needIds.length) await assertAccessible(tx.clientNeed.count({ where: { id: { in: l.needIds }, ...needScope(actor) } }), l.needIds.length, "links.needIds");
  if (l.propertyIds.length) await assertAccessible(tx.property.count({ where: { id: { in: l.propertyIds } } }), l.propertyIds.length, "links.propertyIds");
  if (l.showingIds.length) await assertAccessible(tx.showing.count({ where: { id: { in: l.showingIds }, ...showingScope(actor) } }), l.showingIds.length, "links.showingIds");
  if (l.dealIds.length) await assertAccessible(tx.deal.count({ where: { id: { in: l.dealIds }, ...dealScope(actor) } }), l.dealIds.length, "links.dealIds");
  if (l.advertisementIds.length) await assertAccessible(tx.advertisement.count({ where: { id: { in: l.advertisementIds } } }), l.advertisementIds.length, "links.advertisementIds");
  if (l.agreementIds.length) await assertAccessible(tx.agreement.count({ where: { id: { in: l.agreementIds }, ...agreementScope(actor) } }), l.agreementIds.length, "links.agreementIds");
  if (l.offerIds.length) await assertAccessible(tx.commercialOffer.count({ where: { id: { in: l.offerIds }, ...offerScope(actor) } }), l.offerIds.length, "links.offerIds");

}

export interface InsertTaskData {
  title: string;
  description?: string | null;
  taskType: Code<"taskType">;
  taskSubtypeCode?: Code<"postdealSubtype"> | null;
  dueAt: Date;
  priority?: Code<"taskPriority">;
  responsibleUserId: string;
  recurrenceKind?: Code<"recurrenceKind">;
  recurrenceInterval?: number;
  recurrenceUntil?: Date | null;
  parentTaskId?: string | null;
}

/** Низкоуровневая вставка задачи и её связей (вызывающая команда уже проверила права). */
export async function insertTask(tx: Tx, createdBy: string, data: InsertTaskData, links: TaskLinks = {}): Promise<{ id: string }> {
  const task = await tx.task.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      taskType: data.taskType,
      taskSubtypeCode: data.taskSubtypeCode ?? null,
      dueAt: data.dueAt,
      priority: data.priority ?? "normal",
      status: "planned",
      responsibleUserId: data.responsibleUserId,
      createdBy,
      recurrenceKind: data.recurrenceKind ?? "none",
      recurrenceInterval: data.recurrenceInterval ?? 1,
      recurrenceUntil: data.recurrenceUntil ?? null,
      parentTaskId: data.parentTaskId ?? null,
    },
    select: { id: true },
  });
  const uniq = (a?: string[]) => [...new Set(a ?? [])];
  const t = task.id;
  if (links.clientIds?.length) await tx.taskClient.createMany({ data: uniq(links.clientIds).map((clientId) => ({ taskId: t, clientId })) });
  if (links.needIds?.length) await tx.taskNeed.createMany({ data: uniq(links.needIds).map((clientNeedId) => ({ taskId: t, clientNeedId })) });
  if (links.propertyIds?.length) await tx.taskProperty.createMany({ data: uniq(links.propertyIds).map((propertyId) => ({ taskId: t, propertyId })) });
  if (links.showingIds?.length) await tx.taskShowing.createMany({ data: uniq(links.showingIds).map((showingId) => ({ taskId: t, showingId })) });
  if (links.dealIds?.length) await tx.taskDeal.createMany({ data: uniq(links.dealIds).map((dealId) => ({ taskId: t, dealId })) });
  if (links.advertisementIds?.length)
    await tx.taskAdvertisement.createMany({ data: uniq(links.advertisementIds).map((advertisementId) => ({ taskId: t, advertisementId })) });
  if (links.agreementIds?.length) await tx.taskAgreement.createMany({ data: uniq(links.agreementIds).map((agreementId) => ({ taskId: t, agreementId })) });
  if (links.offerIds?.length) await tx.taskCommercialOffer.createMany({ data: uniq(links.offerIds).map((commercialOfferId) => ({ taskId: t, commercialOfferId })) });
  return task;
}

async function loadTaskLinks(tx: Tx, taskId: string): Promise<Required<TaskLinks>> {
  const t = await tx.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      clientLinks: { select: { clientId: true } },
      needLinks: { select: { clientNeedId: true } },
      propertyLinks: { select: { propertyId: true } },
      showingLinks: { select: { showingId: true } },
      dealLinks: { select: { dealId: true } },
      advertisementLinks: { select: { advertisementId: true } },
      agreementLinks: { select: { agreementId: true } },
      offerLinks: { select: { commercialOfferId: true } },
    },
  });
  return {
    clientIds: t.clientLinks.map((x) => x.clientId),
    needIds: t.needLinks.map((x) => x.clientNeedId),
    propertyIds: t.propertyLinks.map((x) => x.propertyId),
    showingIds: t.showingLinks.map((x) => x.showingId),
    dealIds: t.dealLinks.map((x) => x.dealId),
    advertisementIds: t.advertisementLinks.map((x) => x.advertisementId),
    agreementIds: t.agreementLinks.map((x) => x.agreementId),
    offerIds: t.offerLinks.map((x) => x.commercialOfferId),
  };
}

/** Клиент, к которому относятся потребности (для автоматической связи задачи с клиентом). */
async function clientIdsOfNeeds(tx: Tx | typeof db, needIds: string[]): Promise<string[]> {
  if (!needIds.length) return [];
  const needs = await tx.clientNeed.findMany({ where: { id: { in: needIds } }, select: { clientId: true } });
  return [...new Set(needs.map((n) => n.clientId))];
}

export async function createTask(actor: Actor, input: unknown): Promise<{ id: string }> {
  const data = parseInput(taskInputSchema, input);
  return transaction(async (tx) => {
    await assertTaskLinksAccessible(tx, actor, data.links);
    const responsibleUserId = await resolveTaskResponsible(tx, actor, data.responsibleUserId, actor.userId);
    const links: TaskLinks = { ...data.links };
    if (links.needIds?.length) links.clientIds = [...new Set([...(links.clientIds ?? []), ...(await clientIdsOfNeeds(tx, links.needIds))])];
    const task = await insertTask(tx, actor.userId, { ...data, responsibleUserId }, links);
    if (data.taskType === "postdeal") {
      await writeAudit(tx, { actorUserId: actor.userId, action: "task.postdeal_created", entityType: "Task", entityId: task.id, after: { taskSubtypeCode: data.taskSubtypeCode, responsibleUserId } });
    }
    return task;
  });
}

async function loadOwnTask(tx: Tx, actor: Actor, taskId: string) {
  const task = await tx.task.findFirst({ where: { id: taskId, ...taskScope(actor) } });
  if (!task) throw new NotFoundError();
  return task;
}

async function lockVersion(tx: Tx, taskId: string, expected: Date) {
  // Optimistic concurrency по updated_at (ТЗ 40.10): обновляем, только если версия совпадает.
  const res = await tx.task.updateMany({ where: { id: taskId, updatedAt: expected }, data: { updatedAt: new Date() } });
  if (res.count === 0) throw new StaleUpdateError();
}

const completeSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  resultComment: zOptText(4000),
  nextTask: nextActionSchema.optional(),
});

export interface CompleteTaskResult {
  completedTaskId: string;
  nextInstanceId: string | null;
  nextTaskId: string | null;
}

/**
 * Завершение задачи. Если задача — последнее открытое действие активной/приостановленной
 * потребности, команда требует следующий шаг (nextTask) — иначе инвариант нарушится (FR-23).
 * Для повторяемой задачи создаётся следующий экземпляр.
 */
export async function completeTask(actor: Actor, taskId: string, input: unknown): Promise<CompleteTaskResult> {
  const data = parseInput(completeSchema, input);
  return transaction(async (tx) => {
    const task = await loadOwnTask(tx, actor, taskId);
    if (!isOpenTaskStatus(task.status)) throw new DomainError("TASK_NOT_OPEN", "Задача уже завершена или отменена");
    await lockVersion(tx, taskId, data.expectedUpdatedAt);
    await tx.task.update({
      where: { id: taskId },
      data: { status: "completed", completedAt: new Date(), resultComment: data.resultComment },
    });
    const links = await loadTaskLinks(tx, taskId);

    let nextInstanceId: string | null = null;
    const nextDue = nextRecurrenceDue(task.dueAt, task.recurrenceKind as Code<"recurrenceKind">, task.recurrenceInterval, task.recurrenceUntil);
    if (nextDue) {
      const inst = await insertTask(
        tx,
        task.createdBy,
        {
          title: task.title,
          description: task.description,
          taskType: task.taskType as Code<"taskType">,
          taskSubtypeCode: task.taskSubtypeCode as Code<"postdealSubtype"> | null,
          dueAt: nextDue,
          priority: task.priority as Code<"taskPriority">,
          responsibleUserId: task.responsibleUserId,
          recurrenceKind: task.recurrenceKind as Code<"recurrenceKind">,
          recurrenceInterval: task.recurrenceInterval,
          recurrenceUntil: task.recurrenceUntil,
          parentTaskId: task.parentTaskId ?? task.id,
        },
        links,
      );
      nextInstanceId = inst.id;
    }

    let nextTaskId: string | null = null;
    if (data.nextTask) {
      const fallback = task.responsibleUserId;
      const responsibleUserId = await resolveTaskResponsible(tx, actor, data.nextTask.responsibleUserId, fallback);
      const created = await insertTask(tx, actor.userId, { ...data.nextTask, responsibleUserId }, links);
      nextTaskId = created.id;
    }

    await assertNeedInvariants(tx, links.needIds);
    return { completedTaskId: taskId, nextInstanceId, nextTaskId };
  });
}

const cancelSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  resultComment: zOptText(4000),
  nextTask: nextActionSchema.optional(),
});

export async function cancelTask(actor: Actor, taskId: string, input: unknown): Promise<{ nextTaskId: string | null }> {
  const data = parseInput(cancelSchema, input);
  return transaction(async (tx) => {
    const task = await loadOwnTask(tx, actor, taskId);
    if (!isOpenTaskStatus(task.status)) throw new DomainError("TASK_NOT_OPEN", "Задача уже завершена или отменена");
    await lockVersion(tx, taskId, data.expectedUpdatedAt);
    await tx.task.update({ where: { id: taskId }, data: { status: "cancelled", resultComment: data.resultComment } });
    const links = await loadTaskLinks(tx, taskId);
    let nextTaskId: string | null = null;
    if (data.nextTask) {
      const responsibleUserId = await resolveTaskResponsible(tx, actor, data.nextTask.responsibleUserId, task.responsibleUserId);
      nextTaskId = (await insertTask(tx, actor.userId, { ...data.nextTask, responsibleUserId }, links)).id;
    }
    await assertNeedInvariants(tx, links.needIds);
    return { nextTaskId };
  });
}

const updateSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  title: zRequiredText(300).optional(),
  description: zOptText(4000),
  dueAt: zDateTime.optional(),
  priority: zCode("taskPriority").optional(),
  status: z.enum(["planned", "in_progress"]).optional(),
  responsibleUserId: zUuid.optional(),
});

/** Перенос срока, изменение приоритета/ответственного/описания открытой задачи. */
export async function updateTask(actor: Actor, taskId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(updateSchema, input);
  return transaction(async (tx) => {
    const task = await loadOwnTask(tx, actor, taskId);
    if (!isOpenTaskStatus(task.status)) throw new DomainError("TASK_NOT_OPEN", "Изменять можно только открытую задачу");
    await lockVersion(tx, taskId, data.expectedUpdatedAt);
    let responsibleUserId: string | undefined;
    if (data.responsibleUserId && data.responsibleUserId !== task.responsibleUserId) {
      if (!isManager(actor) && task.responsibleUserId !== actor.userId) throw new ForbiddenError("Передать задачу может руководитель или её ответственный");
      responsibleUserId = await resolveTaskResponsible(tx, actor, data.responsibleUserId, task.responsibleUserId);
    }
    await tx.task.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.dueAt ? { dueAt: data.dueAt } : {}),
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(responsibleUserId ? { responsibleUserId } : {}),
      },
    });
    if (responsibleUserId) {
      await writeAudit(tx, {
      actorUserId: actor.userId,
        action: "task.responsible_changed",
        entityType: "Task",
        entityId: taskId,
        before: { responsibleUserId: task.responsibleUserId },
        after: { responsibleUserId },
      });
    }
    if (data.dueAt && task.taskType === "postdeal") {
      await writeAudit(tx, { actorUserId: actor.userId, action: "task.due_changed", entityType: "Task", entityId: taskId, before: { dueAt: task.dueAt }, after: { dueAt: data.dueAt } });
    }
    return { id: taskId };
  });
}

/** Число открытых задач по потребности (для подсказок UI). */
export async function countOpenTasksForNeed(needId: string): Promise<number> {
  return db.taskNeed.count({ where: { clientNeedId: needId, task: { status: { in: [...OPEN_TASK_STATUSES] } } } });
}
