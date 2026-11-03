import { z } from "zod";
import { transaction } from "@/shared/db/client";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zOptCode, zOptDateTime, zOptText, zUuid } from "@/shared/validation";
import type { Actor } from "@/modules/auth/domain/actor";
import { leadRequestScope } from "@/modules/access/domain/scopes";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { loadAccessibleClient } from "@/modules/clients/application/client-service";
import { applyNeedStateChange, embeddedNeedChangeSchema, loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { insertTask, nextActionSchema, resolveTaskResponsible } from "@/modules/tasks/application/task-service";

/**
 * Коммуникации (FR-07, ТЗ 40.7): append-oriented факты истории клиента.
 * После записи можно сразу создать Task либо изменить этап/статус потребности
 * в той же транзакции (paused с Task возврата, closed с причиной).
 */
export const communicationSchema = z.object({
  clientId: zUuid,
  clientNeedId: zUuid.optional(),
  leadRequestId: zUuid.optional(),
  communicationType: zCode("communicationType"),
  channelCode: z.string().trim().max(50).nullish().transform((v) => v || null),
  occurredAt: zOptDateTime,
  resultCode: zOptCode("communicationResult"),
  comment: zOptText(4000),
  nextTask: nextActionSchema.optional(),
  needChange: embeddedNeedChangeSchema.optional(),
});

export async function recordCommunication(actor: Actor, input: unknown): Promise<{ id: string; taskId: string | null }> {
  const d = parseInput(communicationSchema, input);
  await assertDictionaryCode("lead_channel", d.channelCode, "channelCode");
  return transaction(async (tx) => {
    await loadAccessibleClient(tx, actor, d.clientId);
    if (d.clientNeedId) {
      const need = await loadAccessibleNeed(tx, actor, d.clientNeedId);
      if (need.clientId !== d.clientId) throw new ValidationError(undefined, { clientNeedId: ["Потребность другого клиента"] });
    }
    if (d.leadRequestId) {
      const lr = await tx.leadRequest.findFirst({ where: { id: d.leadRequestId, ...leadRequestScope(actor) } });
      if (!lr) throw new NotFoundError();
    }
    const c = await tx.communication.create({
      data: {
        clientId: d.clientId,
        clientNeedId: d.clientNeedId ?? null,
        leadRequestId: d.leadRequestId ?? null,
        authorUserId: actor.userId,
        communicationType: d.communicationType,
        channelCode: d.channelCode,
        occurredAt: d.occurredAt ?? new Date(),
        resultCode: d.resultCode,
        comment: d.comment,
      },
      select: { id: true },
    });
    let taskId: string | null = null;
    if (d.needChange && d.clientNeedId) {
      const r = await applyNeedStateChange(tx, actor, d.clientNeedId, d.needChange, { reasonCode: "communication" });
      taskId = r.taskId;
    } else if (d.nextTask) {
      const responsibleUserId = await resolveTaskResponsible(tx, actor, d.nextTask.responsibleUserId, actor.userId);
      taskId = (
        await insertTask(tx, actor.userId, { ...d.nextTask, responsibleUserId }, { clientIds: [d.clientId], needIds: d.clientNeedId ? [d.clientNeedId] : [] })
      ).id;
    }
    return { id: c.id, taskId };
  });
}
