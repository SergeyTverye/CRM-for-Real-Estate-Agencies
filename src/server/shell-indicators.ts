import "server-only";
import type { Actor } from "@/modules/auth/domain/actor";
import { countOverdueTasks } from "@/modules/tasks/application/task-queries";

/** Индикаторы верхней панели: число просроченных действий текущего пользователя. */
export async function getShellIndicators(actor: Actor): Promise<{ overdue: number }> {
  return { overdue: await countOverdueTasks(actor) };
}
