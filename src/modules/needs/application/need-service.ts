import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import { DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId,
  parseInput,
  zCode,
  zExpectedUpdatedAt,
  zOptBool,
  zOptCode,
  zOptDecimal,
  zOptInt,
  zOptMoney,
  zOptText,
  zUuid,
} from "@/shared/validation";
import type { Code } from "@/shared/codebook";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { needScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { insertTask, nextActionSchema, resolveTaskResponsible, type NextActionInput } from "@/modules/tasks/application/task-service";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";
import { loadAccessibleClient, reactivateClientIfInactive } from "@/modules/clients/application/client-service";
import { assertNeedInvariants } from "../domain/need-invariant";



export const needParamsSchema = z
  .object({
    operationType: z.string().trim().min(1, "Выберите операцию"),
    propertyType: z.string().trim().min(1, "Выберите тип недвижимости"),
    propertySubtype: z.string().trim().max(50).nullish().transform((v) => v || null),
    financingType: zOptCode("financingType"),
    mortgageStatus: zOptCode("mortgageStatus"),
    budgetMin: zOptMoney,
    budgetMax: zOptMoney,
    district: zOptText(200),
    locationText: zOptText(1000),
    areaMin: zOptDecimal,
    areaMax: zOptDecimal,
    commercialPurpose: z.string().trim().max(50).nullish().transform((v) => v || null),
    floorMin: zOptInt,
    floorMax: zOptInt,
    roomsMin: zOptInt,
    roomsMax: zOptInt,
    landAreaMin: zOptDecimal,
    landAreaMax: zOptDecimal,
    buildingAreaMin: zOptDecimal,
    buildingAreaMax: zOptDecimal,
    powerRequirement: zOptDecimal,
    parkingRequirement: zOptBool,
    tenantRequirement: zOptBool,
    notes: zOptText(4000),
  })
  .superRefine((p, ctx) => {
    if (p.budgetMin && p.budgetMax && Number(p.budgetMin) > Number(p.budgetMax))
      ctx.addIssue({ code: "custom", path: ["budgetMax"], message: "Максимум меньше минимума" });
    if (p.areaMin && p.areaMax && Number(p.areaMin) > Number(p.areaMax))
      ctx.addIssue({ code: "custom", path: ["areaMax"], message: "Максимум меньше минимума" });
    if (p.mortgageStatus && p.mortgageStatus !== "not_applicable" && p.financingType && !["mortgage", "mixed"].includes(p.financingType))
      ctx.addIssue({ code: "custom", path: ["mortgageStatus"], message: "Статус ипотеки применим только при ипотеке/смешанном финансировании" });
  });

export type NeedParams = z.infer<typeof needParamsSchema>;

async function validateNeedDictionaries(p: Partial<NeedParams>, previous?: Partial<NeedParams>) {
  await assertDictionaryCode("need_operation_type", p.operationType, "operationType", previous?.operationType);
  await assertDictionaryCode("property_type", p.propertyType, "propertyType", previous?.propertyType);
  await assertDictionaryCode("property_subtype", p.propertySubtype, "propertySubtype", previous?.propertySubtype);
  await assertDictionaryCode("commercial_purpose", p.commercialPurpose, "commercialPurpose", previous?.commercialPurpose);
}

export const createNeedSchema = needParamsSchema.and(
  z.object({
    clientId: zUuid,
    responsibleUserId: zUuid.optional(),
    stage: zCode("needStage").default("new"),
    nextAction: nextActionSchema,
  }),
);


export async function insertNeed(
  tx: Tx,
  actor: Actor,
  data: NeedParams & { clientId: string; responsibleUserId: string; stage: Code<"needStage"> },
  nextAction: NextActionInput,
): Promise<{ id: string; taskId: string }> {
  const need = await tx.clientNeed.create({
    data: { ...data, status: "active", createdBy: actor.userId },
    select: { id: true },
  });
  await tx.needStageHistory.create({
    data: { clientNeedId: need.id, fromStage: null, toStage: data.stage, fromStatus: null, toStatus: "active", reasonCode: "opened", changedBy: actor.userId },
  });
  const responsibleUserId = await resolveTaskResponsible(tx, actor, nextAction.responsibleUserId, data.responsibleUserId);
  const task = await insertTask(tx, actor.userId, { ...nextAction, responsibleUserId }, { needIds: [need.id], clientIds: [data.clientId] });
  return { id: need.id, taskId: task.id };
}


async function resolveNeedResponsible(tx: Tx, actor: Actor, clientResponsibleId: string, requested?: string): Promise<string> {
  if (!requested || requested === clientResponsibleId) return clientResponsibleId;
  if (!isManager(actor)) throw new ForbiddenError("Ответственным за потребность становится ответственный за клиента; изменить его может руководитель");
  const user = await tx.user.findUnique({ where: { id: requested }, select: { isActive: true } });
  if (!user?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
  return requested;
}

export async function createNeed(actor: Actor, input: unknown): Promise<{ id: string; taskId: string }> {
  const data = parseInput(createNeedSchema, input);
  await validateNeedDictionaries(data);
  return transaction(async (tx) => {
    const client = await loadAccessibleClient(tx, actor, data.clientId);
    if ((await reactivateClientIfInactive(tx, client.id)) === "archived")
      throw new DomainError("CLIENT_ARCHIVED", "Клиент в архиве. Новая потребность возможна после восстановления клиента руководителем.");
    const responsibleUserId = await resolveNeedResponsible(tx, actor, client.responsibleUserId, data.responsibleUserId);
    const { nextAction, clientId, stage, responsibleUserId: _r, ...params } = data;
    void _r;
    const res = await insertNeed(tx, actor, { ...params, clientId, stage, responsibleUserId }, nextAction);
    await assertNeedInvariants(tx, [res.id]);
    return res;
  });
}

export async function loadAccessibleNeed(tx: Tx | typeof db, actor: Actor, needId: string) {
  assertRecordId(needId);
  const need = await tx.clientNeed.findFirst({ where: { id: needId, ...needScope(actor) } });
  if (!need) throw new NotFoundError();
  return need;
}

const updateParamsSchema = needParamsSchema.and(z.object({ expectedUpdatedAt: zExpectedUpdatedAt, nextAction: nextActionSchema.optional() }));


export async function updateNeedParams(actor: Actor, needId: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(updateParamsSchema, input);
  return transaction(async (tx) => {
    const need = await loadAccessibleNeed(tx, actor, needId);
    await validateNeedDictionaries(data, need as unknown as Partial<NeedParams>);
    const { expectedUpdatedAt, nextAction, ...params } = data;
    const res = await tx.clientNeed.updateMany({ where: { id: needId, updatedAt: expectedUpdatedAt }, data: params });
    if (res.count === 0) throw new StaleUpdateError();
    if (nextAction) {
      const responsibleUserId = await resolveTaskResponsible(tx, actor, nextAction.responsibleUserId, need.responsibleUserId);
      await insertTask(tx, actor.userId, { ...nextAction, responsibleUserId }, { needIds: [needId], clientIds: [need.clientId] });
    }
    await assertNeedInvariants(tx, [needId]);
    return { id: needId };
  });
}

const changeStateBase = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  stage: zCode("needStage").optional(),
  status: zCode("needStatus").optional(),
  stopReasonCode: zOptCode("stopReason"),
  stopComment: zOptText(2000),
  comment: zOptText(2000),
  nextAction: nextActionSchema.optional(),
  returnTask: nextActionSchema.optional(),
  cancelOpenTasks: z.boolean().default(true),
});

type StateRuleInput = { status?: string; stopReasonCode?: string | null; stopComment?: string | null; returnTask?: unknown };

function stateRules(d: StateRuleInput, ctx: z.RefinementCtx) {
  if (d.status === "closed" && d.stopReasonCode === "no_match") ctx.addIssue({ code: "custom", path: ["stopReasonCode"], message: "Отсутствие подходящих объектов не завершает потребность. Оставьте её в работе или назначьте возврат из паузы." });
  if (d.status === "closed" && !d.stopReasonCode) ctx.addIssue({ code: "custom", path: ["stopReasonCode"], message: "Укажите причину остановки" });
  if (d.status === "closed" && d.stopReasonCode === "other" && !d.stopComment)
    ctx.addIssue({ code: "custom", path: ["stopComment"], message: "Для причины «Другое» нужен комментарий" });
  if (d.status === "paused" && !d.returnTask) ctx.addIssue({ code: "custom", path: ["returnTask"], message: "Для паузы назначьте задачу возврата с датой" });
}

export const changeStateSchema = changeStateBase.superRefine(stateRules);

export type ChangeNeedStateInput = z.input<typeof changeStateSchema>;


export const embeddedNeedChangeSchema = changeStateBase.omit({ expectedUpdatedAt: true }).superRefine(stateRules);


export async function applyNeedStateChange(
  tx: Tx,
  actor: Actor,
  needId: string,
  d: Omit<z.output<typeof changeStateSchema>, "expectedUpdatedAt"> & { expectedUpdatedAt?: Date },
  opts: { reasonCode?: string } = {},
) {
  const need = await loadAccessibleNeed(tx, actor, needId);
  
  
  const expected = d.expectedUpdatedAt ?? need.updatedAt;
  const res = await tx.clientNeed.updateMany({ where: { id: needId, updatedAt: expected }, data: { updatedAt: new Date() } });
  if (res.count === 0) throw new StaleUpdateError();

  const toStatus = d.status ?? need.status;
  const toStage = d.stage ?? need.stage;
  const now = new Date();
  const update: Record<string, unknown> = {};
  if (toStage !== need.stage) update.stage = toStage;
  if (toStatus !== need.status) update.status = toStatus;
  if (toStatus === "closed") {
    update.stopReasonCode = d.stopReasonCode;
    update.stopComment = d.stopComment;
    update.closedAt = need.status === "closed" && need.closedAt ? need.closedAt : now;
  } else if (toStatus === "success") {
    update.stopReasonCode = null;
    update.stopComment = null;
    update.closedAt = need.status === "success" && need.closedAt ? need.closedAt : now;
  } else if (need.status === "closed" || need.status === "success") {
    
    update.stopReasonCode = null;
    update.stopComment = null;
    update.closedAt = null;
  }
  if (Object.keys(update).length) await tx.clientNeed.update({ where: { id: needId }, data: update });

  if (toStage !== need.stage || toStatus !== need.status) {
    await tx.needStageHistory.create({
      data: {
        clientNeedId: needId,
        fromStage: need.stage,
        toStage,
        fromStatus: need.status,
        toStatus,
        reasonCode: toStatus === "closed" ? d.stopReasonCode : (opts.reasonCode ?? null),
        comment: d.comment ?? (toStatus === "closed" ? d.stopComment : null),
        changedBy: actor.userId,
      },
    });
  }

  
  if ((toStatus === "closed" || toStatus === "success") && d.cancelOpenTasks) {
    const open = await tx.task.findMany({
      where: { status: { in: [...OPEN_TASK_STATUSES] }, needLinks: { some: { clientNeedId: needId } } },
      select: { id: true },
    });
    if (open.length) {
      await tx.task.updateMany({
        where: { id: { in: open.map((t) => t.id) } },
        data: { status: "cancelled", resultComment: toStatus === "closed" ? "Потребность закрыта" : "Потребность успешно завершена" },
      });
    }
  }

  const continuation = toStatus === "paused" ? d.returnTask : toStatus === "active" ? d.nextAction : undefined;
  let taskId: string | null = null;
  if (continuation) {
    const responsibleUserId = await resolveTaskResponsible(tx, actor, continuation.responsibleUserId, need.responsibleUserId);
    const title = continuation.title;
    taskId = (await insertTask(tx, actor.userId, { ...continuation, taskType: toStatus === "paused" ? "pause_return" : continuation.taskType, title, responsibleUserId }, { needIds: [needId], clientIds: [need.clientId] })).id;
  }
  if (toStatus === "active" && (need.status === "closed" || need.status === "success")) {
    await reactivateClientIfInactive(tx, need.clientId);
  }
  await assertNeedInvariants(tx, [needId]);
  return { id: needId, taskId, fromStatus: need.status, toStatus, fromStage: need.stage, toStage };
}

export async function changeNeedState(actor: Actor, needId: string, input: unknown) {
  const d = parseInput(changeStateSchema, input);
  return transaction((tx) => applyNeedStateChange(tx, actor, needId, d));
}


const STAGE_ORDER: Code<"needStage">[] = ["new", "qualification", "selection", "showing", "negotiation", "preliminary_agreement", "documents", "deal", "postdeal"];

export async function advanceNeedStage(tx: Tx, actor: Actor, needId: string, target: Code<"needStage">, reasonCode: string): Promise<void> {
  const need = await tx.clientNeed.findUniqueOrThrow({ where: { id: needId }, select: { stage: true, status: true } });
  if (need.status !== "active") return;
  if (STAGE_ORDER.indexOf(need.stage as Code<"needStage">) >= STAGE_ORDER.indexOf(target)) return;
  await tx.clientNeed.update({ where: { id: needId }, data: { stage: target } });
  await tx.needStageHistory.create({
    data: { clientNeedId: needId, fromStage: need.stage, toStage: target, fromStatus: need.status, toStatus: need.status, reasonCode, changedBy: actor.userId },
  });
}

const reassignSchema = z.object({ responsibleUserId: zUuid, comment: zOptText(1000) });

export async function reassignNeed(actor: Actor, needId: string, input: unknown): Promise<void> {
  if (!isManager(actor)) throw new ForbiddenError("Сменить ответственного может только руководитель");
  const data = parseInput(reassignSchema, input);
  await transaction(async (tx) => {
    const need = await loadAccessibleNeed(tx, actor, needId);
    const user = await tx.user.findUnique({ where: { id: data.responsibleUserId }, select: { isActive: true } });
    if (!user?.isActive) throw new ValidationError(undefined, { responsibleUserId: ["Сотрудник не найден или деактивирован"] });
    if (need.responsibleUserId === data.responsibleUserId) return;
    await tx.clientNeed.update({ where: { id: needId }, data: { responsibleUserId: data.responsibleUserId } });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "need.responsible_changed",
      entityType: "ClientNeed",
      entityId: needId,
      before: { responsibleUserId: need.responsibleUserId },
      after: { responsibleUserId: data.responsibleUserId, comment: data.comment },
    });
  });
}
