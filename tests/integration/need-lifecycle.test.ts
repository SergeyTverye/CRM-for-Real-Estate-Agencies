import { beforeEach, describe, expect, it } from "vitest";
import { db, inDays, makeClient, makeNeed, nextAction, NEED_PARAMS, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { changeNeedState, createNeed, updateNeedParams } from "@/modules/needs/application/need-service";
import { completeTask, cancelTask } from "@/modules/tasks/application/task-service";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

async function needVersion(id: string) {
  return (await db.clientNeed.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
}

describe("T03 / UC-03: жизненный цикл ClientNeed", () => {
  it("active создаётся только со следующим действием; несколько потребностей одного клиента", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    await expect(createNeed(u.realtor1, { clientId, ...NEED_PARAMS })).rejects.toBeInstanceOf(ValidationError);
    const n1 = await makeNeed(u.realtor1, clientId, { financingType: "mortgage", mortgageStatus: "in_progress" });
    const n2 = await makeNeed(u.realtor1, clientId, { operationType: "buy", propertyType: "residential" });
    const needs = await db.clientNeed.findMany({ where: { clientId }, include: { taskLinks: { include: { task: true } } } });
    expect(needs).toHaveLength(2);
    for (const n of needs) {
      expect(n.status).toBe("active");
      expect(n.taskLinks.filter((l) => ["planned", "in_progress"].includes(l.task.status))).toHaveLength(1);
    }
    const mortgage = needs.find((n) => n.id === n1.id)!;
    expect([mortgage.financingType, mortgage.mortgageStatus]).toEqual(["mortgage", "in_progress"]);
    expect(await db.needStageHistory.count({ where: { clientNeedId: n2.id } })).toBe(1);
  });

  it("paused требует Task возврата; closed — причину и closed_at; other — комментарий; success — без причины", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id } = await makeNeed(u.realtor1, clientId);

    await expect(changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "paused" })).rejects.toBeInstanceOf(ValidationError);
    await changeNeedState(u.realtor1, id, {
      expectedUpdatedAt: await needVersion(id),
      status: "paused",
      returnTask: { title: "Вернуться к потребности", dueAt: inDays(30), taskType: "call_or_contact" },
    });
    expect((await db.clientNeed.findUniqueOrThrow({ where: { id } })).status).toBe("paused");

    await expect(changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "closed" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "closed", stopReasonCode: "other" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "closed", stopReasonCode: "budget" });
    const closed = await db.clientNeed.findUniqueOrThrow({ where: { id } });
    expect(closed.stopReasonCode).toBe("budget");
    expect(closed.closedAt).not.toBeNull();
    
    expect(await db.task.count({ where: { needLinks: { some: { clientNeedId: id } }, status: "planned" } })).toBe(0);

    
    await expect(changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "active" })).rejects.toBeInstanceOf(DomainError);
    await changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "active", nextAction: nextAction() });
    await changeNeedState(u.realtor1, id, { expectedUpdatedAt: await needVersion(id), status: "success", stage: "deal" });
    const success = await db.clientNeed.findUniqueOrThrow({ where: { id } });
    expect(success.status).toBe("success");
    expect(success.stopReasonCode).toBeNull();

    const history = await db.needStageHistory.findMany({ where: { clientNeedId: id }, orderBy: { occurredAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["active", "paused", "closed", "active", "success"]);
    expect(history.find((h) => h.toStatus === "closed")?.reasonCode).toBe("budget");
  });

  it("CHECK в БД не даёт сохранить closed без причины даже в обход сервиса", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id } = await makeNeed(u.realtor1, clientId);
    await expect(db.clientNeed.update({ where: { id }, data: { status: "closed" } })).rejects.toThrow();
  });

  it("завершение последней задачи active-потребности требует следующего шага", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: needId, taskId } = await makeNeed(u.realtor1, clientId);
    const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const err = await completeTask(u.realtor1, taskId, { expectedUpdatedAt: t.updatedAt.toISOString(), resultComment: "Позвонил" }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("NEXT_ACTION_REQUIRED");
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("planned"); 
    const res = await completeTask(u.realtor1, taskId, {
      expectedUpdatedAt: t.updatedAt.toISOString(),
      resultComment: "Позвонил, договорились о показе",
      nextTask: { title: "Показ объекта", dueAt: inDays(2), taskType: "showing_or_meeting" },
    });
    expect(res.nextTaskId).not.toBeNull();
    const links = await db.taskNeed.findMany({ where: { clientNeedId: needId }, include: { task: true } });
    expect(links.filter((l) => l.task.status === "planned")).toHaveLength(1);
    
    const next = await db.task.findUniqueOrThrow({ where: { id: res.nextTaskId! } });
    await expect(cancelTask(u.realtor1, next.id, { expectedUpdatedAt: next.updatedAt.toISOString() })).rejects.toBeInstanceOf(DomainError);
  });

  it("повторяемая задача создаёт следующий экземпляр при завершении", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: needId } = await makeNeed(u.realtor1, clientId);
    const { createTask } = await import("@/modules/tasks/application/task-service");
    const { id } = await createTask(u.realtor1, {
      title: "Ежемесячная проверка договоров",
      taskType: "contract_check",
      dueAt: inDays(1),
      recurrenceKind: "monthly",
      links: { needIds: [needId] },
    });
    const t = await db.task.findUniqueOrThrow({ where: { id } });
    const r = await completeTask(u.realtor1, id, { expectedUpdatedAt: t.updatedAt.toISOString() });
    const inst = await db.task.findUniqueOrThrow({ where: { id: r.nextInstanceId! } });
    expect(inst.parentTaskId).toBe(id);
    expect(inst.recurrenceKind).toBe("monthly");
    expect(inst.dueAt.getTime()).toBeGreaterThan(t.dueAt.getTime() + 27 * 86_400_000);
  });

  it("риелтор не видит и не меняет чужую потребность", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id } = await makeNeed(u.realtor1, clientId);
    await expect(updateNeedParams(u.realtor2, id, { ...NEED_PARAMS, expectedUpdatedAt: await needVersion(id) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeNeedState(u.realtor2, id, { expectedUpdatedAt: await needVersion(id), stage: "selection" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
