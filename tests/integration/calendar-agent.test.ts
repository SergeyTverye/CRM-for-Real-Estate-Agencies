import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedBase, db, type TestUsers, apiRequest, sessionCookieFor, routeParams } from "../helpers/fixtures";
import { createTask, updateTask } from "@/modules/tasks/application/task-service";
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
import { listNotifications, unreadCount, snoozeNotification } from "@/modules/notifications/application/notification-service";
import { saveCalendarEvent, listCalendar, archiveCalendarEvent } from "@/modules/calendar/application/calendar-service";
import { GET as eventsApi } from "@/app/api/v1/calendar/route";
import { GET as singleEventApi } from "@/app/api/v1/calendar/events/[id]/route";
import { PATCH as notificationApi } from "@/app/api/v1/notifications/[id]/route";
let users: TestUsers;
beforeEach(async()=>{await db.calendarEvent.count(); await db.notification.count(); await resetDatabase(); users=await seedBase();});
describe("calendar/notification integration and authorization",()=>{
  it("is idempotent across disconnect/restart and delivers missed deadlines",async()=>{
    const due=new Date(Date.now()-60000);
    await createTask(users.realtor1,{title:"synthetic",taskType:"call_or_contact",dueAt:due.toISOString()});
    await generateNotifications(); const count=await db.notification.count();
    await db.$disconnect(); await generateNotifications();
    expect(await db.notification.count()).toBe(count); expect(count).toBe(2);
    expect((await unreadCount(users.realtor1)).count).toBe(2);
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
    expect(await db.notification.count({where:{sourceId:t.id,kind:"task",state:"pending"}})).toBe(1);
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
