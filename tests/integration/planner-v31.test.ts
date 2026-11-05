import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, type TestUsers } from "../helpers/fixtures";
import { createTask, completeTask } from "@/modules/tasks/application/task-service";
import { listChecklist, saveChecklistItem } from "@/modules/tasks/application/checklist-service";
import { bulkCreateTasks } from "@/modules/tasks/application/bulk-task-service";
import { listCalendar, saveCalendarEvent } from "@/modules/calendar/application/calendar-service";
import { aggregatePlanner, getPlannerSetting, setPlannerSetting } from "@/modules/calendar/application/planner-service";
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
import { snoozeNotification } from "@/modules/notifications/application/notification-service";
import { scheduleShowing } from "@/modules/showings/application/showing-service";
let users: TestUsers;
const dueAt = "2026-11-06T03:00:00.000Z";
const range = { from:"2026-10-31T17:00:00.000Z",to:"2027-01-31T17:00:00.000Z" };
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
describe("AT-11 / AT-12 planner", () => {
  it("requires explicit confirmation for open required checklist, retains result and versions", async () => {
    const t = await createTask(users.realtor1,{ title:"Проверка",taskType:"other",dueAt });
    const item = await saveChecklistItem(users.realtor1,t.id,{ title:"Согласовать",required:true,dueAt,sortOrder:2 });
    const task = await db.task.findUniqueOrThrow({ where:{ id:t.id } });
    await expect(completeTask(users.realtor1,t.id,{ expectedUpdatedAt:task.updatedAt.toISOString() })).rejects.toMatchObject({ code:"OPEN_REQUIRED_CHECKLIST" });
    expect((await db.task.findUniqueOrThrow({ where:{ id:t.id } })).status).toBe("planned");
    const first = (await listChecklist(users.realtor1,t.id)).items[0]!;
    await saveChecklistItem(users.realtor1,t.id,{ title:first.title,required:true,status:"done",result:"Согласовано",expectedUpdatedAt:first.updatedAt.toISOString() },item.id);
    await expect(saveChecklistItem(users.realtor1,t.id,{ title:"Потерянное изменение",expectedUpdatedAt:first.updatedAt.toISOString() },item.id)).rejects.toMatchObject({ code:"STALE_UPDATE" });
    await completeTask(users.realtor1,t.id,{ expectedUpdatedAt:task.updatedAt.toISOString() });
    expect((await listChecklist(users.realtor1,t.id)).completed).toBe(1);
  });
  it("audits explicit override and serializes concurrent required item insertion", async () => {
    const t = await createTask(users.realtor1,{ title:"Контроль",taskType:"other",dueAt });
    await saveChecklistItem(users.realtor1,t.id,{ title:"Обязательный",required:true });
    const task = await db.task.findUniqueOrThrow({ where:{ id:t.id } });
    await completeTask(users.realtor1,t.id,{ expectedUpdatedAt:task.updatedAt.toISOString(),confirmOpenRequired:true });
    expect(await db.auditLog.count({ where:{ entityId:t.id,action:"task.completed_with_open_checklist" } })).toBe(1);
    await expect(saveChecklistItem(users.realtor1,t.id,{ title:"Позднее изменение" })).rejects.toMatchObject({ code:"TASK_NOT_OPEN" });
  });
  it("bulk preview writes nothing; concurrent retry creates exactly one batch and client task each", async () => {
    const a = await makeClient(users.realtor1), b = await makeClient(users.realtor1);
    const input = { clientIds:[a.id,b.id,a.id],idempotencyKey:randomUUID(),task:{ title:"Повторный контакт",taskType:"call_or_contact",dueAt } };
    const preview = await bulkCreateTasks(users.realtor1,input);
    if (!preview.preview) throw new Error("Expected preview");
    expect(preview.count).toBe(2); expect(await db.task.count()).toBe(0);
    await expect(bulkCreateTasks(users.realtor1,{ ...input,confirmed:true })).rejects.toMatchObject({ code:"BULK_PREVIEW_REQUIRED" });
    const result = await Promise.all([1,2].map(() => bulkCreateTasks(users.realtor1,{ ...input,confirmed:true,previewToken:preview.previewToken })));
    if (result[0]?.preview || result[1]?.preview) throw new Error("Expected commit");
    expect(result[0]?.batchId).toBe(result[1]?.batchId);
    expect(await db.task.count()).toBe(2); expect(await db.bulkTaskBatch.count()).toBe(1);
    expect(await db.taskClient.count()).toBe(2);
    const changed = { ...input,task:{ ...input.task,title:"Другая задача" } };
    const changedPreview = await bulkCreateTasks(users.realtor1,changed);
    if (!changedPreview.preview) throw new Error("Expected preview");
    await expect(bulkCreateTasks(users.realtor1,{ ...changed,confirmed:true,previewToken:changedPreview.previewToken })).rejects.toMatchObject({ code:"IDEMPOTENCY_CONFLICT" });
  });
  it("weekdays repeat creates one next instance, copies checklist, and stops at COUNT", async () => {
    const t = await createTask(users.realtor1,{ title:"Будни",taskType:"other",dueAt,recurrenceRule:"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=2" });
    await saveChecklistItem(users.realtor1,t.id,{ title:"Проверить",required:true });
    const task = await db.task.findUniqueOrThrow({ where:{ id:t.id } });
    const result = await completeTask(users.realtor1,t.id,{ expectedUpdatedAt:task.updatedAt.toISOString(),confirmOpenRequired:true });
    const next = await db.task.findUniqueOrThrow({ where:{ id:result.nextInstanceId! } });
    expect(next.dueAt.toISOString()).toBe("2026-11-09T03:00:00.000Z"); expect(next.parentTaskId).toBe(t.id);
    expect((await listChecklist(users.realtor1,next.id)).total).toBe(1);
    const final = await completeTask(users.realtor1,next.id,{ expectedUpdatedAt:next.updatedAt.toISOString(),confirmOpenRequired:true });
    expect(final.nextInstanceId).toBeNull();
  });
  it("SQL aggregate equals scoped primary projections including showing dedup and private meetings", async () => {
    const c = await makeClient(users.realtor1), n = await makeNeed(users.realtor1,c.id), p = await makeProperty(users.realtor1);
    await scheduleShowing(users.realtor1,{ clientNeedId:n.id,propertyId:p.id,scheduledAt:dueAt });
    await createTask(users.realtor1,{ title:"Критично",taskType:"other",dueAt,priority:"critical",links:{ clientIds:[c.id] } });
    await createTask(users.realtor2,{ title:"SECRET",taskType:"other",dueAt });
    await db.agreement.create({ data:{ clientId:c.id,agreementType:"information",status:"signed",signedAt:new Date("2026-11-01"),responsibleUserId:users.realtor1.userId,validUntil:new Date("2026-12-01") } });
    await saveCalendarEvent(users.realtor2,{ title:"PRIVATE_SECRET",startAt:dueAt,endAt:"2026-11-06T04:00:00Z",clientId:null,recurrenceRule:"FREQ=MONTHLY;COUNT=3" });
    for (const actor of [users.manager,users.realtor1,users.realtor2]) for (const filter of [{},{ type:"task" },{ status:"busy" },{ priority:"critical" },{ clientId:c.id }].filter(f => actor !== users.realtor2 || !f.clientId)) {
      const items = await listCalendar(actor,{ ...range,...filter },{ now:new Date("2026-11-05T03:00Z") });
      const aggregate = await aggregatePlanner(actor,{ ...range,...filter },new Date("2026-11-05T03:00Z"));
      expect(aggregate.total).toBe(items.length);
      for (const tone of ["red","yellow","green","gray"] as const) expect(aggregate.days.reduce((s,d) => s+d[tone],0)).toBe(items.filter(i => i.tone === tone).length);
      expect(JSON.stringify(aggregate)).not.toMatch(/SECRET|title|sourceId/);
    }
  });
  it("manager setting changes thresholds and rejects stale saves / other roles", async () => {
    expect((await getPlannerSetting()).soonThresholdHours).toBe(24);
    await expect(setPlannerSetting(users.realtor1,{ soonThresholdHours:1,expectedUpdatedAt:null })).rejects.toMatchObject({ code:"FORBIDDEN" });
    await setPlannerSetting(users.manager,{ soonThresholdHours:1,expectedUpdatedAt:null });
    await expect(setPlannerSetting(users.manager,{ soonThresholdHours:2,expectedUpdatedAt:null })).rejects.toMatchObject({ code:"STALE_UPDATE" });
    expect((await getPlannerSetting()).soonThresholdHours).toBe(1);
  });
  it("aggregates 1500 task records in PostgreSQL without loading task rows", async () => {
    await db.task.createMany({ data:Array.from({ length:1500 },(_,i) => ({ title:`Нагрузка ${i}`,taskType:"other",status:"planned",priority:"normal",dueAt:new Date(dueAt),responsibleUserId:users.realtor1.userId,createdBy:users.realtor1.userId })) });
    const loadRows = vi.spyOn(db.task,"findMany");
    try {
      const result = await aggregatePlanner(users.realtor1,range,new Date("2026-11-05T03:00Z"));
      expect(result.total).toBe(1500); expect(result.days).toHaveLength(1); expect(loadRows).not.toHaveBeenCalled();
      expect(result.days[0]?.yellow).toBe(1500);
    } finally { loadRows.mockRestore(); }
  });
  it("delivers before/due/overdue independently, deduplicates after disconnect and retains snooze", async () => {
    const at = new Date(Date.now()+3600000);
    const t = await createTask(users.realtor1,{ title:"Уведомления",taskType:"other",dueAt:at.toISOString() });
    await generateNotifications(new Date(+at-900000));
    expect(await db.notification.count({ where:{ sourceId:t.id,state:"delivered" } })).toBe(2);
    await generateNotifications(at);
    expect(await db.notification.count({ where:{ sourceId:t.id,state:"delivered" } })).toBe(3);
    await db.$disconnect(); await generateNotifications(new Date(+at+60000)); await generateNotifications(new Date(+at+60000));
    expect(await db.notification.count({ where:{ sourceId:t.id } })).toBe(4);
    expect(await db.notification.count({ where:{ sourceId:t.id,state:"delivered" } })).toBe(4);
    const reminder = await db.notification.findFirstOrThrow({ where:{ sourceId:t.id,dedupKey:{ contains:":overdue:" } } });
    const until = new Date(+at+7200000);
    await snoozeNotification(users.realtor1,reminder.id,{ until:until.toISOString() });
    await generateNotifications(new Date(+until-1)); expect((await db.notification.findUniqueOrThrow({ where:{ id:reminder.id } })).state).toBe("pending");
    await db.$disconnect(); await generateNotifications(until); expect((await db.notification.findUniqueOrThrow({ where:{ id:reminder.id } })).state).toBe("delivered");
    expect((await db.task.findUniqueOrThrow({ where:{ id:t.id } })).dueAt).toEqual(at);
  });
});
