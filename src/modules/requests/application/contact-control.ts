import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { isManager } from "@/modules/auth/domain/actor";
import { leadRequestScope, taskScope } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { PROSPECTIVE_RESULTS } from "../domain/prospective";

export async function getContactControl(actor: Actor, userId?: string) {
  const responsibleUserId = isManager(actor) ? userId : actor.userId;
  const assigned = responsibleUserId ? { responsibleUserId } : {};
  const now = new Date();
  const [requests, overdue] = await Promise.all([
    db.leadRequest.findMany({ where: { AND: [leadRequestScope(actor), assigned], resultCode: { in: PROSPECTIVE_RESULTS }, statusCode: { not: "closed" },
      OR: [{ clientNeedId: null }, { need: { status: { in: ["active", "paused"] }, taskLinks: { none: { task: { status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { gte: now } } } } } }] },
      select: { id: true, occurredAt: true, resultCode: true }, orderBy: { occurredAt: "asc" } }),
    db.task.findMany({ where: { AND: [taskScope(actor), assigned], taskType: { in: ["call_or_contact", "pause_return"] }, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: now } },
      select: { id: true, title: true, dueAt: true }, orderBy: { dueAt: "asc" } }),
  ]);
  return { requests, overdue };
}
