import { describe, expect, it } from "vitest";
import { canReadEventDetails, freeIntervals, occurrences, parseRecurrence, privateProjection } from "@/modules/calendar/domain/calendar-rules";
import { notificationKey, reminderAt, taskNotificationKind } from "@/modules/notifications/domain/notification-rules";
const at = (day: string) => new Date(day);
describe("calendar and notification rules", () => {
  it("merges intervals, clips to working hours and ignores deadlines and zero durations", () => {
    const free = freeIntervals(at("2026-11-05T02:00Z"),at("2026-11-05T11:00Z"),[
      { start: "2026-11-05T03:00Z" }, { start: "2026-11-05T04:00Z", end: "2026-11-05T04:00Z" },
      { start: "2026-11-05T01:00Z",end:"2026-11-05T03:00Z" },
      { start: "2026-11-05T02:30Z",end:"2026-11-05T04:00Z" },
      { start: "2026-11-05T10:00Z",end:"2026-11-05T12:00Z" },
    ]);
    expect(free).toEqual([{ start: "2026-11-05T04:00:00.000Z",end:"2026-11-05T10:00:00.000Z" }]);
  });
  it("uses inclusive UNTIL and skips February for a monthly day 31", () => {
    const dates = occurrences({ start: "2026-01-31T03:00Z",end:"2026-01-31T04:00Z",recurrenceRule:"FREQ=MONTHLY;UNTIL=20260331T030000Z" },at("2026-01-01"),at("2026-05-01"),"Asia/Novosibirsk");
    expect(dates.map(d => d.start)).toEqual(["2026-01-31T03:00:00.000Z","2026-03-31T03:00:00.000Z"]);
  });
  it("preserves local hour across a timezone transition", () => {
    const dates = occurrences({ start:"2026-03-07T14:00Z",end:"2026-03-07T15:00Z",recurrenceRule:"FREQ=DAILY" },at("2026-03-07"),at("2026-03-10"),"America/New_York");
    expect(dates.map(d => d.start)).toEqual(["2026-03-07T14:00:00.000Z","2026-03-08T13:00:00.000Z","2026-03-09T13:00:00.000Z"]);
  });
  it("rejects unsupported and invalid recurrence syntax", () => {
    expect(() => parseRecurrence("FREQ=DAILY;BYDAY=MO")).toThrow();
    expect(() => parseRecurrence("FREQ=DAILY;UNTIL=20260231T030000Z")).toThrow();
  });
  it("private projection is an allowlist even for manager consumers", () => {
    expect(canReadEventDetails("manager",{ ownerUserId:"other",visibility:"private" })).toBe(false);
    const dto = privateProjection({ id:"opaque",type:"calendar_event",sourceId:"secret",title:"Чужой клиент",description:"секрет",start:"2026-11-05T02:00Z",end:"2026-11-05T03:00Z",status:"scheduled",ownerUserId:"other",editable:true,updatedAt:"version",url:"/clients/secret",recurrenceRule:"FREQ=DAILY" });
    expect(dto.title).toBe("Занято");
    expect(JSON.stringify(dto)).not.toMatch(/Чужой|секрет|secret|version|recurrence|url/);
  });
  it("computes lead times without changing the source deadline and deduplicates by occurrence", () => {
    const due = at("2026-11-05T03:00Z");
    expect(reminderAt(due,15).toISOString()).toBe("2026-11-05T02:45:00.000Z");
    expect(due.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(notificationKey("u","task","t","task",due)).toBe(notificationKey("u","task","t","task",new Date(due)));
    expect(notificationKey("u","task","t","task",due)).not.toBe(notificationKey("u","task","t","task",at("2026-11-06T03:00Z")));
    expect(taskNotificationKind({ taskType:"pause_return",recurrenceKind:"none" })).toBe("pause_return");
    expect(taskNotificationKind({ taskType:"call_or_contact",recurrenceKind:"yearly" })).toBe("annual_contact");
    expect(taskNotificationKind({ taskType:"postdeal",recurrenceKind:"none" })).toBe("postdeal");
  });
});

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
    expect(()=>parseRecurrence("FREQ=HOURLY")).toThrow();
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
