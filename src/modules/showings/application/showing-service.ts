import { redactClientLink } from "@/modules/access/application/redact-client";
import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zDateOnly, zDateTime, zExpectedUpdatedAt, zOptCode, zOptDateTime, zOptText, zPagination, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, showingScope } from "@/modules/access/domain/scopes";
import { insertTask } from "@/modules/tasks/application/task-service";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { advanceNeedStage, applyNeedStateChange, embeddedNeedChangeSchema, loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";

/**
 * Показы (FR-08, UC-05 RecordShowingResult, ТЗ 37.8).
 * Назначение показа создаёт задачу-встречу (она же следующее действие потребности) и отмечает
 * объект в подборе. Фиксация результата + переход этапа/статуса + следующее действие выполняются
 * одной транзакцией; результат структурирован (status + result_code) и дополнен комментарием.
 */

const createSchema = z.object({
  clientNeedId: zUuid,
  propertyId: zUuid,
  scheduledAt: zDateTime,
  responsibleUserId: zUuid.optional(),
  participantsText: zOptText(1000),
  comment: zOptText(2000),
});

export async function scheduleShowing(actor: Actor, input: unknown): Promise<{ id: string; taskId: string }> {
  const d = parseInput(createSchema, input);
  return transaction(async (tx) => {
    const need = await loadAccessibleNeed(tx, actor, d.clientNeedId);
    if (!["active", "paused"].includes(need.status)) throw new DomainError("NEED_NOT_OPEN", "Показ можно назначить только по открытой потребности");
    const property = await tx.property.findUnique({ where: { id: d.propertyId }, select: { id: true, addressText: true } });
    if (!property) throw new NotFoundError("Объект не найден");
    let responsibleUserId = need.responsibleUserId;
    if (d.responsibleUserId && d.responsibleUserId !== responsibleUserId) {
      if (!isManager(actor) && d.responsibleUserId !== actor.userId) throw new ForbiddenError("Назначить другого ответственного может руководитель");
      const u = await tx.user.findUnique({ where: { id: d.responsibleUserId }, select: { isActive: true } });
      if (!u?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
      responsibleUserId = d.responsibleUserId;
    }
    const showing = await tx.showing.create({
      data: {
        clientNeedId: need.id,
        propertyId: property.id,
        responsibleUserId,
        scheduledAt: d.scheduledAt,
        status: "planned",
        participantsText: d.participantsText,
        comment: d.comment,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    const task = await insertTask(
      tx,
      actor.userId,
      { title: `Показ: ${property.addressText}`, taskType: "showing_or_meeting", dueAt: d.scheduledAt, responsibleUserId },
      { needIds: [need.id], clientIds: [need.clientId], propertyIds: [property.id], showingIds: [showing.id] },
    );
    // Объект в подборе получает статус «назначен показ» (новая запись, если ранее не предлагался/был закрыт).
    const active = await tx.needPropertyMatch.findFirst({
      where: { clientNeedId: need.id, propertyId: property.id, status: { in: ["proposed", "interested", "showing_planned"] } },
      orderBy: { offeredAt: "desc" },
    });
    if (active) await tx.needPropertyMatch.update({ where: { id: active.id }, data: { status: "showing_planned" } });
    else
      await tx.needPropertyMatch.create({
        data: { clientNeedId: need.id, propertyId: property.id, status: "showing_planned", sourceCode: "showing", createdBy: actor.userId },
      });
    await advanceNeedStage(tx, actor, need.id, "showing", "auto:showing_planned");
    return { id: showing.id, taskId: task.id };
  });
}

const rescheduleSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  scheduledAt: zDateTime.optional(),
  participantsText: zOptText(1000),
  comment: zOptText(2000),
});

export async function updateShowing(actor: Actor, showingId: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(rescheduleSchema, input);
  return transaction(async (tx) => {
    const s = await tx.showing.findFirst({ where: { id: showingId, ...showingScope(actor) } });
    if (!s) throw new NotFoundError();
    if (s.status !== "planned") throw new DomainError("SHOWING_CLOSED", "Изменять можно только запланированный показ");
    const res = await tx.showing.updateMany({
      where: { id: showingId, updatedAt: d.expectedUpdatedAt },
      data: {
        ...(d.scheduledAt ? { scheduledAt: d.scheduledAt } : {}),
        ...(d.participantsText !== undefined ? { participantsText: d.participantsText } : {}),
        ...(d.comment !== undefined ? { comment: d.comment } : {}),
      },
    });
    if (res.count === 0) throw new StaleUpdateError();
    if (d.scheduledAt) {
      await tx.task.updateMany({
        where: { showingLinks: { some: { showingId } }, status: { in: [...OPEN_TASK_STATUSES] }, taskType: "showing_or_meeting" },
        data: { dueAt: d.scheduledAt },
      });
    }
    return { id: showingId };
  });
}

const resultSchema = z
  .object({
    expectedUpdatedAt: zExpectedUpdatedAt,
    status: z.enum(["completed", "cancelled", "no_show"]),
    occurredAt: zOptDateTime,
    resultCode: zOptCode("showingResult"),
    comment: zOptText(4000),
    needChange: embeddedNeedChangeSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.status === "completed" && !d.resultCode) ctx.addIssue({ code: "custom", path: ["resultCode"], message: "Укажите результат показа" });
  });

const MATCH_BY_RESULT: Record<string, string> = { interested: "interested", negotiation: "interested", thinking: "interested", rejected: "rejected" };

/**
 * UC-05: результат показа, StageHistory и переход ClientNeed с требуемым продолжением — одной транзакцией.
 * Если потребность остаётся active и у неё не остаётся открытых действий, команда требует next action.
 */
export async function recordShowingResult(actor: Actor, showingId: string, input: unknown): Promise<{ id: string; taskId: string | null }> {
  const d = parseInput(resultSchema, input);
  return transaction(async (tx) => {
    const s = await tx.showing.findFirst({ where: { id: showingId, ...showingScope(actor) } });
    if (!s) throw new NotFoundError();
    if (s.status !== "planned") throw new DomainError("SHOWING_CLOSED", "Результат показа уже зафиксирован");
    const res = await tx.showing.updateMany({
      where: { id: showingId, updatedAt: d.expectedUpdatedAt },
      data: {
        status: d.status,
        resultCode: d.status === "completed" ? d.resultCode : null,
        occurredAt: d.status === "completed" ? (d.occurredAt ?? new Date()) : null,
        comment: d.comment ?? s.comment,
      },
    });
    if (res.count === 0) throw new StaleUpdateError();

    // Задача-встреча по показу выполнена (или отменена).
    await tx.task.updateMany({
      where: { showingLinks: { some: { showingId } }, status: { in: [...OPEN_TASK_STATUSES] }, taskType: "showing_or_meeting" },
      data: d.status === "completed" ? { status: "completed", completedAt: new Date(), resultComment: d.comment } : { status: "cancelled", resultComment: d.comment ?? "Показ не состоялся" },
    });

    if (d.status === "completed" && d.resultCode && MATCH_BY_RESULT[d.resultCode]) {
      const match = await tx.needPropertyMatch.findFirst({
        where: { clientNeedId: s.clientNeedId, propertyId: s.propertyId, status: { in: ["proposed", "interested", "showing_planned"] } },
        orderBy: { offeredAt: "desc" },
      });
      if (match) {
        await tx.needPropertyMatch.update({
          where: { id: match.id },
          data: { status: MATCH_BY_RESULT[d.resultCode]!, ...(d.resultCode === "rejected" ? { rejectionReasonCode: "other", comment: d.comment ?? match.comment } : {}) },
        });
      }
    }

    let taskId: string | null = null;
    if (d.needChange) {
      const r = await applyNeedStateChange(tx, actor, s.clientNeedId, d.needChange, { reasonCode: `showing:${d.resultCode ?? d.status}` });
      taskId = r.taskId;
    } else {
      await assertNeedInvariants(tx, [s.clientNeedId]);
    }
    return { id: showingId, taskId };
  });
}

// ───── Queries ─────

export const showingFiltersSchema = zPagination.extend({
  status: zCode("showingStatus").optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
  responsibleUserId: zUuid.optional(),
  needId: zUuid.optional(),
  propertyId: zUuid.optional(),
  mine: z.enum(["yes"]).optional(),
});

export async function listShowings(actor: Actor, raw: unknown) {
  const f = parseInput(showingFiltersSchema, raw);
  const and: Prisma.ShowingWhereInput[] = [showingScope(actor)];
  if (f.status) and.push({ status: f.status });
  if (f.from) and.push({ scheduledAt: { gte: f.from } });
  if (f.to) and.push({ scheduledAt: { lt: new Date(f.to.getTime() + 86_400_000) } });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.mine) and.push({ responsibleUserId: actor.userId });
  if (f.needId) and.push({ clientNeedId: f.needId });
  if (f.propertyId) and.push({ propertyId: f.propertyId });
  const where: Prisma.ShowingWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.showing.findMany({
      where,
      orderBy: { scheduledAt: f.status === "planned" ? "asc" : "desc" },
      ...skipTake(f),
      include: {
        property: { select: { id: true, addressText: true } },
        responsible: { select: { id: true, displayName: true } },
        need: { select: { id: true, client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
      },
    }),
    db.showing.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({ ...r, need: redactClientLink(actor, r.need), clientVisible: canSeeClient(actor, r.need.client) })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getShowing(actor: Actor, showingId: string) {
  assertRecordId(showingId);
  const s = await db.showing.findFirst({
    where: { id: showingId, ...showingScope(actor) },
    include: {
      property: { select: { id: true, addressText: true, price: true, area: true } },
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      need: {
        select: {
          id: true,
          stage: true,
          status: true,
          updatedAt: true,
          responsibleUserId: true,
          client: { select: { id: true, displayName: true, responsibleUserId: true } },
        },
      },
    },
  });
  if (!s) throw new NotFoundError();
  return { showing: { ...s, need: redactClientLink(actor, s.need) }, clientVisible: canSeeClient(actor, s.need.client) };
}
