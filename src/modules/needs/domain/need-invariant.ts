import type { DbOrTx } from "@/shared/db/client";
import { ConflictError, DomainError } from "@/shared/errors";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";

/**
 * Межтабличные инварианты жизненного цикла ClientNeed (ТЗ 19.6, 40.2.1, FR-23).
 * Проверяются в конце каждой бизнес-команды внутри той же транзакции:
 *  - active  → есть незавершённая следующая Task.
 *  - paused  → есть незавершённая Task возврата (due_at обязателен для любой Task).
 *  - closed  → stop_reason_code и closed_at (дублируется CHECK-ограничением).
 *  - success → фиксирует результат, следующая Task не требуется.
 */
export async function findNeedInvariantViolations(tx: DbOrTx, needIds: string[]): Promise<{ needId: string; status: string; violation: string }[]> {
  if (needIds.length === 0) return [];
  const needs = await tx.clientNeed.findMany({
    where: { id: { in: needIds } },
    select: {
      id: true,
      status: true,
      stopReasonCode: true,
      closedAt: true,
      taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] }, taskType: "pause_return" } }, select: { taskId: true } },
      _count: { select: { taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] } } } } } },
    },
  });
  const out: { needId: string; status: string; violation: string }[] = [];
  for (const n of needs) {
    const open = n._count.taskLinks;
    if (n.status === "active" && open === 0) out.push({ needId: n.id, status: n.status, violation: "NEXT_ACTION_REQUIRED" });
    if (n.status === "paused" && n.taskLinks.length === 0) out.push({ needId: n.id, status: n.status, violation: "RETURN_TASK_REQUIRED" });
    if (n.status === "closed" && (!n.stopReasonCode || !n.closedAt)) out.push({ needId: n.id, status: n.status, violation: "STOP_REASON_REQUIRED" });
  }
  return out;
}

export async function assertNeedInvariants(tx: DbOrTx, needIds: string[]): Promise<void> {
  const violations = await findNeedInvariantViolations(tx, [...new Set(needIds)]);
  if (violations.length === 0) return;
  const first = violations[0]!;
  const message =
    first.violation === "NEXT_ACTION_REQUIRED"
      ? "Для потребности в работе необходимо назначить следующее действие (задачу со сроком)."
      : first.violation === "RETURN_TASK_REQUIRED"
        ? "Создайте новую задачу возврата (тип «Возврат из паузы») с ответственным и сроком или смените статус потребности в этой операции."
        : "Для закрытия потребности укажите причину остановки.";
  const ErrorType = first.violation === "RETURN_TASK_REQUIRED" ? ConflictError : DomainError;
  throw new ErrorType(first.violation, message, { needIds: violations.map((v) => v.needId) });
}
