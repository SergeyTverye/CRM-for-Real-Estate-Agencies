import { z } from "zod";
import { db, transaction, Prisma, type Tx } from "@/shared/db/client";
import { taskScope } from "@/modules/access/domain/scopes";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import type { Actor } from "@/modules/auth/domain/actor";
import { DomainError, NotFoundError, StaleUpdateError } from "@/shared/errors";
import { parseInput, zDateTime, zExpectedUpdatedAt, zOptText, zRequiredText, zUuid } from "@/shared/validation";
import { resolveTaskResponsible } from "./task-service";
import { writeAudit } from "@/modules/audit/application/audit";

async function lockTask(tx: Tx, actor: Actor, taskId: string) {
  // Serialize checklist edits with completion, including a concurrent new required item.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`);
  const task = await tx.task.findFirst({ where: { id: taskId, AND: [taskScope(actor), safeTaskTextScope(actor)] } });
  if (!task) throw new NotFoundError();
  if (!["planned", "in_progress"].includes(task.status)) throw new DomainError("TASK_NOT_OPEN", "Чек-лист завершённой задачи недоступен для изменения");
  return task;
}
export async function listChecklist(actor: Actor, taskId: string) {
  parseInput(zUuid, taskId);
  if (!await db.task.count({ where: { id: taskId, AND: [taskScope(actor), safeTaskTextScope(actor)] } })) throw new NotFoundError();
  const items = await db.taskChecklistItem.findMany({ where: { taskId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { responsible: { select: { displayName: true } } } });
  return { items, completed: items.filter(i => i.status === "done").length, total: items.length, overdue: items.filter(i => i.status === "open" && i.dueAt && i.dueAt < new Date()).length };
}
const fields = z.object({ title: zRequiredText(300), sortOrder: z.number().int().min(0).max(10000).default(0), responsibleUserId: zUuid.nullish(), dueAt: zDateTime.nullish(), required: z.boolean().default(false), status: z.enum(["open", "done", "cancelled"]).default("open"), result: zOptText(4000) });
export async function saveChecklistItem(actor: Actor, taskId: string, input: unknown, itemId?: string) {
  parseInput(zUuid, taskId); if (itemId) parseInput(zUuid, itemId);
  const data = parseInput(fields.extend({ expectedUpdatedAt: zExpectedUpdatedAt.optional() }), input);
  return transaction(async tx => {
    const task = await lockTask(tx, actor, taskId);
    if (data.responsibleUserId) await resolveTaskResponsible(tx, actor, data.responsibleUserId, task.responsibleUserId);
    const { expectedUpdatedAt, ...values } = data;
    const patch = { ...values, completedAt: data.status === "done" ? new Date() : null, completedBy: data.status === "done" ? actor.userId : null };
    let id = itemId;
    if (id) {
      if (!await tx.taskChecklistItem.count({ where: { id, taskId } })) throw new NotFoundError();
      if (!expectedUpdatedAt || !(await tx.taskChecklistItem.updateMany({ where: { id, taskId, updatedAt: expectedUpdatedAt }, data: patch })).count) throw new StaleUpdateError();
    } else {
      if (await tx.taskChecklistItem.count({ where: { taskId } }) >= 200) throw new DomainError("CHECKLIST_LIMIT", "В задаче допускается до 200 пунктов");
      id = (await tx.taskChecklistItem.create({ data: { ...patch, taskId } })).id;
    }
    await writeAudit(tx, { actorUserId: actor.userId, action: "task.checklist_changed", entityType: "Task", entityId: taskId, after: { itemId: id, status: data.status } });
    return { id };
  });
}
