import { lockSql } from "@/shared/db/dialect";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction, Prisma } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope } from "@/modules/access/domain/scopes";
import { DomainError, NotFoundError } from "@/shared/errors";
import { parseInput, zUuid } from "@/shared/validation";
import { insertTask, resolveTaskResponsible, taskInputSchema } from "./task-service";
import { writeAudit } from "@/modules/audit/application/audit";

const schema = z.object({ clientIds: z.array(zUuid).min(1).max(100), task: taskInputSchema, idempotencyKey: z.string().uuid(), confirmed: z.boolean().default(false), previewToken: z.string().length(64).optional() });
export async function bulkCreateTasks(actor: Actor, input: unknown) {
  const data = parseInput(schema, input);
  const clientIds = [...new Set(data.clientIds)].sort();
  if (Object.values(data.task.links).some(ids => ids?.length)) throw new DomainError("BULK_LINKS", "Для массовой задачи используются только выбранные клиенты");
  const clients = await db.client.findMany({ where: { AND: [clientScope(actor), { id: { in: clientIds }, status: { not: "archived" } }] }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
  if (clients.length !== clientIds.length) throw new NotFoundError();
  const template = JSON.parse(JSON.stringify({ task: data.task, clientIds })) as Prisma.InputJsonValue;
  const token = createHash("sha256").update(JSON.stringify({ actor: actor.userId, template })).digest("hex");
  if (!data.confirmed) return { preview: true as const, previewToken: token, clients, count: clients.length };
  if (data.previewToken !== token) throw new DomainError("BULK_PREVIEW_REQUIRED", "Сначала проверьте предпросмотр текущих параметров");
  return transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${data.idempotencyKey}, 0))`));
    const previous = await tx.bulkTaskBatch.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    if (previous) {
      if (previous.createdBy !== actor.userId || canonical(previous.template) !== canonical(template)) throw new DomainError("IDEMPOTENCY_CONFLICT", "Ключ уже использован для другой операции");
      return { preview: false as const, batchId: previous.id, count: previous.count, repeated: true };
    }
    if (await tx.client.count({ where: { AND: [clientScope(actor), { id: { in: clientIds }, status: { not: "archived" } }] } }) !== clientIds.length) throw new NotFoundError();
    const responsibleUserId = await resolveTaskResponsible(tx, actor, data.task.responsibleUserId, actor.userId);
    const batch = await tx.bulkTaskBatch.create({ data: { idempotencyKey: data.idempotencyKey, createdBy: actor.userId, count: clients.length, template } });
    for (const clientId of clientIds) {
      const task = await insertTask(tx, actor.userId, { ...data.task, responsibleUserId }, { clientIds: [clientId] });
      await tx.task.update({ where: { id: task.id }, data: { bulkBatchId: batch.id } });
    }
    await writeAudit(tx, { actorUserId: actor.userId, action: "task.bulk_created", entityType: "BulkTaskBatch", entityId: batch.id, after: { count: clients.length } });
    return { preview: false as const, batchId: batch.id, count: clients.length, repeated: false };
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
