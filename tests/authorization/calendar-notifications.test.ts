import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, type TestUsers, makeClient, apiRequest, sessionCookieFor, routeParams } from "../helpers/fixtures";
import { archiveCalendarEvent, listCalendar, saveCalendarEvent } from "@/modules/calendar/application/calendar-service";
import { readNotification, snoozeNotification, listNotifications } from "@/modules/notifications/application/notification-service";
import { GET as eventGET } from "@/app/api/v1/calendar/events/[id]/route";
import { GET as countGET } from "@/app/api/v1/notifications/unread-count/route";
import { createTask } from "@/modules/tasks/application/task-service";
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
describe("calendar / notifications authorization", () => {
  let users: TestUsers;
  beforeEach(async () => { await db.calendarEvent.count(); await db.notification.count(); await resetDatabase(); users = await seedBase(); });
  it("masks private events in API for peers AND manager; denies writes", async () => {
    const startAt = new Date().toISOString(),endAt = new Date(Date.now()+3600000).toISOString();
    const event = await saveCalendarEvent(users.realtor1,{ title:"Личный секрет",description:"Закрытые сведения",startAt,endAt });
    for (const actor of [users.realtor2,users.manager]) {
      const response = await eventGET(apiRequest("GET",`/api/v1/calendar/events/${event.id}`,{cookie:await sessionCookieFor(actor)}),routeParams({id:event.id}));
      expect(response.status).toBe(200);
      const body = await response.json(); expect(body.title).toBe("Занято"); expect(body.description).toBeUndefined(); expect(body.clientId).toBeUndefined();
      await expect(archiveCalendarEvent(actor,event.id,{expectedUpdatedAt:startAt})).rejects.toMatchObject({code:"NOT_FOUND"});
      const list = await listCalendar(actor,{from:startAt,to:endAt,type:"calendar_event"});
      expect(list[0]?.title).toBe("Занято"); expect(list[0]?.sourceId).toBeUndefined();
    }
  });
  it("rejects linking foreign clients and denies notification IDs of other recipients", async () => {
    const c = await makeClient(users.realtor2);
    await expect(saveCalendarEvent(users.realtor1,{title:"Общая запись",visibility:"public",clientId:c.id,startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).rejects.toMatchObject({code:"NOT_FOUND"});
    await createTask(users.realtor1,{title:"Синтетическая задача",taskType:"other",dueAt:new Date(Date.now()-1000).toISOString()});
    await generateNotifications();
    const n = await db.notification.findFirstOrThrow({where:{recipientUserId:users.realtor1.userId}});
    expect((await listNotifications(users.realtor2,{})).total).toBe(0);
    await expect(readNotification(users.realtor2,n.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(snoozeNotification(users.realtor2,n.id,{until:new Date(Date.now()+3600000).toISOString()})).rejects.toMatchObject({code:"NOT_FOUND"});
    const res = await countGET(apiRequest("GET","/api/v1/notifications/unread-count",{cookie:await sessionCookieFor(users.realtor2)}),{params:Promise.resolve({})});
    expect(await res.json()).toEqual({count:0});
  });
});
