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
