import { describe, expect, it } from "vitest";
import { freeIntervals, occurrences, parseRecurrence, privateProjection } from "@/modules/calendar/domain/calendar-rules";
import { notificationKey, reminderAt, taskNotificationKind } from "@/modules/notifications/domain/notification-rules";
const d = (day: string) => new Date(`2026-11-${day}T03:00:00Z`);
describe("calendar and internal notification rules", () => {
  it("merges overlaps and excludes point deadlines", () => {
    expect(freeIntervals(d("05"), new Date(+d("05")+4*3600000), [
      { start: d("05").toISOString() },
      { start: new Date(+d("05")+3600000).toISOString(), end: new Date(+d("05")+2*3600000).toISOString() },
      { start: new Date(+d("05")+90*60000).toISOString(), end: new Date(+d("05")+3*3600000).toISOString() },
    ])).toEqual([{ start: d("05").toISOString(), end: new Date(+d("05")+3600000).toISOString() }, { start: new Date(+d("05")+3*3600000).toISOString(), end: new Date(+d("05")+4*3600000).toISOString() }]);
  });
  it("expands daily and weekly through inclusive UNTIL", () => {
    const e = { start: d("05").toISOString(), end: new Date(+d("05")+3600000).toISOString(), recurrenceRule: "FREQ=DAILY;UNTIL=20261107T030000Z" };
    expect(occurrences(e,d("05"),d("10"),"Asia/Novosibirsk")).toHaveLength(3);
    expect(occurrences({...e,recurrenceRule:"FREQ=WEEKLY"},d("05"),d("20"),"Asia/Novosibirsk")).toHaveLength(3);
  });
  it("skips invalid monthly dates", () => {
    const e = { start: "2026-01-31T03:00:00Z", end:"2026-01-31T04:00:00Z",recurrenceRule:"FREQ=MONTHLY" };
    expect(occurrences(e,new Date(e.start),new Date("2026-04-01"),"Asia/Novosibirsk").map(o=>o.start.slice(0,10))).toEqual(["2026-01-31","2026-03-31"]);
  });
  it("rejects unsupported RRULE and invalid UNTIL", () => {
    expect(()=>parseRecurrence("FREQ=YEARLY")).toThrow();
    expect(()=>parseRecurrence("FREQ=DAILY;UNTIL=20260231T030000Z")).toThrow();
  });
  it("projects private intervals without content or CRM/source links", () => {
    const projected = privateProjection({id:"opaque",sourceId:"secret",title:"Client secret",description:"PII",type:"calendar_event",start:d("05").toISOString(),end:d("06").toISOString(),ownerUserId:"u",status:"scheduled",editable:true,url:"/clients/secret"});
    expect(projected.title).toBe("Занято");
    expect(projected).not.toHaveProperty("sourceId"); expect(projected).not.toHaveProperty("description"); expect(projected).not.toHaveProperty("url");
  });
  it.each([0,15,60,1440,37])("supports lead %i", minutes => expect(+reminderAt(d("05"),minutes)).toBe(+d("05")-minutes*60000));
  it("classifies contacts and builds stable occurrence keys", () => {
    expect(taskNotificationKind({taskType:"pause_return",recurrenceKind:"none"})).toBe("pause_return");
    expect(taskNotificationKind({taskType:"postdeal",recurrenceKind:"none"})).toBe("postdeal");
    expect(taskNotificationKind({taskType:"call_or_contact",recurrenceKind:"yearly"})).toBe("annual_contact");
    expect(notificationKey("u","task","id","task",d("05"))).toBe(notificationKey("u","task","id","task",d("05")));
    expect(notificationKey("u","task","id","task",d("05"))).not.toBe(notificationKey("u","task","id","task",d("06")));
  });
});
