import "server-only";
import type { Actor } from "@/modules/auth/domain/actor";
import { countTodayTasks, getTodayReferenceTime } from "@/modules/tasks/application/task-queries";


export async function getShellIndicators(actor: Actor, now = getTodayReferenceTime()): Promise<{ overdue: number }> {
  return { overdue: (await countTodayTasks(actor, now)).overdue };
}
