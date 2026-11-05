import { GET as eventsApi } from "@/app/api/v1/calendar/route";
import { GET as singleEventApi } from "@/app/api/v1/calendar/events/[id]/route";
import { PATCH as notificationApi } from "@/app/api/v1/notifications/[id]/route";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, type TestUsers, makeClient, makeNeed, makeProperty, apiRequest, sessionCookieFor, routeParams } from "../helpers/fixtures";
import { createTask, updateTask } from "@/modules/tasks/application/task-service";
import { scheduleShowing } from "@/modules/showings/application/showing-service";
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
import { listNotifications, readNotification, snoozeNotification, unreadCount } from "@/modules/notifications/application/notification-service";
import { listCalendar, saveCalendarEvent, archiveCalendarEvent } from "@/modules/calendar/application/calendar-service";

describe("calendar / notifications database integration (existing v2.4.1 schema required)", () => {
  let users: TestUsers;
  beforeEach(async () => {
    // Fail explicitly rather than silently marking missing schema tests passed/skipped.
    await db.calendarEvent.count(); await db.notification.count();
    await resetDatabase(); users = await seedBase();
  });
  it("reconciles a reschedule, catches up after restart, deduplicates and keeps snooze separate", async () => {
    const due = new Date(Date.now()+3600000);
    const t = await createTask(users.realtor1,{ title:"Синтетическая задача",taskType:"call_or_contact",dueAt:due.toISOString() });
    await generateNotifications(); await generateNotifications();
    expect(await db.notification.count({ where:{ sourceId:t.id,kind:"task" } })).toBe(3);
    const old = await db.task.findUniqueOrThrow({ where:{ id:t.id } });
    const moved = new Date(+due+86400000);
    await updateTask(users.realtor1,t.id,{ dueAt:moved.toISOString(),expectedUpdatedAt:old.updatedAt.toISOString() });
    await generateNotifications();
    expect((await db.notification.findFirstOrThrow({ where:{ sourceId:t.id,kind:"task",state:"pending" } })).triggerAt.toISOString()).toBe(new Date(+moved-900000).toISOString());
    expect(await db.notification.count({ where:{ sourceId:t.id,kind:"task",state:"dismissed" } })).toBe(3);
    await db.$disconnect();
    await generateNotifications(new Date(+moved+1000));
    await Promise.all([generateNotifications(new Date(+moved+2000)),generateNotifications(new Date(+moved+2000))]); // competing workers
    expect(await db.notification.count({ where:{ sourceId:t.id,kind:"task",state:"delivered" } })).toBe(2);
    const n = await db.notification.findFirstOrThrow({ where:{ sourceId:t.id,kind:"task",state:"delivered" } });
    await snoozeNotification(users.realtor1,n.id,{ until:new Date(Date.now()+3*86400000).toISOString() });
    expect((await db.task.findUniqueOrThrow({ where:{ id:t.id } })).dueAt).toEqual(moved);
    await generateNotifications(new Date(Date.now()+4*86400000));
    expect((await db.notification.findUniqueOrThrow({ where:{ id:n.id } })).state).toBe("delivered");
    await readNotification(users.realtor1,n.id);
    expect((await unreadCount(users.realtor1)).count).toBe(3); // assignment and two other deadline phases remain
  });
  it("shows one showing, not its helper task, and never exposes foreign task text", async () => {
    const c = await makeClient(users.realtor1), need = await makeNeed(users.realtor1,c.id), p = await makeProperty(users.realtor1);
    const at = new Date(Date.now()+3600000);
    const showing = await scheduleShowing(users.realtor1,{ clientNeedId:need.id,propertyId:p.id,scheduledAt:at.toISOString() });
    const items = await listCalendar(users.realtor1,{ from:new Date(+at-1000).toISOString(),to:new Date(+at+1000).toISOString() });
    expect(items.filter(e => e.type === "showing" && e.sourceId === showing.id)).toHaveLength(1);
    expect(items.find(e => e.sourceId === showing.taskId)).toBeUndefined();
    await createTask(users.realtor1,{ title:"Чужие паспортные сведения",taskType:"other",responsibleUserId:users.manager.userId,dueAt:at.toISOString() });
    await generateNotifications();
    expect(JSON.stringify(await listNotifications(users.manager,{}))).not.toContain("паспортные");
  });
  it("schedules recurring personal events without independent duplicate rows", async () => {
    const startAt = new Date().toISOString(),endAt = new Date(Date.now()+3600000).toISOString();
    await saveCalendarEvent(users.realtor1,{ title:"Личная встреча",startAt,endAt,recurrenceRule:"FREQ=DAILY" });
    await generateNotifications(new Date(Date.now()+3*86400000)); await generateNotifications(new Date(Date.now()+3*86400000));
    const rows = await db.notification.findMany({ where:{ sourceType:"calendar_event" } });
    expect(new Set(rows.map(n=>n.dedupKey)).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(2);
  });
});

let users: TestUsers;
beforeEach(async()=>{await db.calendarEvent.count(); await db.notification.count(); await resetDatabase(); users=await seedBase();});
describe("calendar/notification integration and authorization",()=>{
  it("is idempotent across disconnect/restart and delivers missed deadlines",async()=>{
    const due=new Date(Date.now()-60000);
    await createTask(users.realtor1,{title:"synthetic",taskType:"call_or_contact",dueAt:due.toISOString()});
    await generateNotifications(); const count=await db.notification.count();
    await db.$disconnect(); await generateNotifications();
    expect(await db.notification.count()).toBe(count); expect(count).toBe(4);
    expect((await unreadCount(users.realtor1)).count).toBe(4);
    expect((await listNotifications(users.realtor2,{})).total).toBe(0);
  });
  it("reschedules pending reminders; snooze never changes task deadline",async()=>{
    const due=new Date(Date.now()+86400000);
    const t=await createTask(users.realtor1,{title:"synthetic",taskType:"call_or_contact",dueAt:due.toISOString()});
    await generateNotifications();
    const old=await db.notification.findFirstOrThrow({where:{sourceId:t.id,kind:"task"}});
    const task=await db.task.findUniqueOrThrow({where:{id:t.id}});
    const moved=new Date(+due+86400000);
    await updateTask(users.realtor1,t.id,{expectedUpdatedAt:task.updatedAt.toISOString(),dueAt:moved.toISOString()});
    await generateNotifications();
    expect((await db.notification.findUniqueOrThrow({where:{id:old.id}})).state).toBe("dismissed");
    expect(await db.notification.count({where:{sourceId:t.id,kind:"task",state:"pending"}})).toBe(3);
    const assignment=await db.notification.findFirstOrThrow({where:{sourceId:t.id,kind:"assignment"}});
    await snoozeNotification(users.realtor1,assignment.id,{until:new Date(Date.now()+60000).toISOString()});
    expect(+(await db.task.findUniqueOrThrow({where:{id:t.id}})).dueAt).toBe(+moved);
    await generateNotifications(new Date(Date.now()+120000));
    expect((await db.notification.findUniqueOrThrow({where:{id:assignment.id}})).state).toBe("delivered");
  });
  it("redacts private events for colleague and manager in list and API",async()=>{
    const start=new Date(Date.now()+3600000),end=new Date(+start+3600000);
    const e=await saveCalendarEvent(users.realtor1,{title:"SECRET_CLIENT",description:"SECRET_PII",startAt:start.toISOString(),endAt:end.toISOString()});
    const range={from:new Date(+start-3600000).toISOString(),to:new Date(+end+3600000).toISOString()};
    for(const viewer of [users.realtor2,users.manager]){
      const items=await listCalendar(viewer,range); expect(items[0]?.title).toBe("Занято"); expect(JSON.stringify(items)).not.toContain("SECRET"); expect(items[0]).not.toHaveProperty("sourceId");
      const cookie=await sessionCookieFor(viewer);
      const res=await eventsApi(apiRequest("GET",`/api/v1/calendar?${new URLSearchParams(range)}`,{cookie}),routeParams({}));
      expect(res.status).toBe(200);expect(await res.text()).not.toContain("SECRET");
      const detail=await singleEventApi(apiRequest("GET",`/api/v1/calendar/events/${e.id}`,{cookie}),routeParams({id:e.id}));
      expect(await detail.text()).not.toContain("SECRET");
      await expect(archiveCalendarEvent(viewer,e.id,{expectedUpdatedAt:new Date().toISOString()})).rejects.toMatchObject({code:"NOT_FOUND"});
    }
  });
  it("rejects another recipient notification through direct API",async()=>{
    await createTask(users.realtor1,{title:"synthetic",taskType:"call_or_contact",dueAt:new Date().toISOString()});await generateNotifications();
    const n=await db.notification.findFirstOrThrow();
    const cookie=await sessionCookieFor(users.realtor2);
    const res=await notificationApi(apiRequest("PATCH",`/api/v1/notifications/${n.id}`,{cookie,body:{action:"read"}}),routeParams({id:n.id}));
    expect(res.status).toBe(404);
  });
});
