import { describe, expect, it } from "vitest";
import { occurrences, parseRecurrence } from "@/modules/calendar/domain/calendar-rules";
import { recurrenceForm, recurrenceRule, type RepeatForm } from "@/modules/calendar/domain/recurrence-form";
import { todayTaskBucket } from "@/modules/calendar/domain/today-counters";
import { groupNotifications, notificationText } from "@/modules/notifications/domain/notification-rules";

const zone = "Asia/Novosibirsk";
const date = (s: string) => new Date(s);
const event = { start: "2026-11-06T03:00:00Z", end: "2026-11-06T04:00:00Z" }; 
const form: RepeatForm = { mode: "weekdays", days: [], end: "count", count: 3, until: "" };
describe("calendar UX recurrence", () => {
  it("skips weekends and counts occurrences, including in later windows", () => {
    const recurrence = recurrenceRule(form, event.start, zone);
    const all = occurrences({ ...event, recurrenceRule: recurrence }, date("2026-11-01"), date("2026-12-01"), zone);
    expect(all.map(e => e.start.slice(0, 10))).toEqual(["2026-11-06", "2026-11-09", "2026-11-10"]);
    expect(occurrences({ ...event, recurrenceRule: recurrence }, date("2026-11-11"), date("2026-12-01"), zone)).toEqual([]);
    expect(recurrenceForm(recurrence, zone)).toEqual({ ...form, days: ["MO", "TU", "WE", "TH", "FR"] });
  });
  it("selects multiple weekly days and ends on a local date inclusively", () => {
    const rule = recurrenceRule({ ...form, mode: "weekly", days: ["MO", "TH"], end: "date", until: "2026-11-12" }, event.start, zone);
    expect(occurrences({ ...event, recurrenceRule: rule }, date("2026-11-01"), date("2026-12-01"), zone).map(e => e.start.slice(0, 10))).toEqual(["2026-11-09", "2026-11-12"]);
    expect(recurrenceForm(rule, zone).until).toBe("2026-11-12");
  });
  it("rejects empty weekdays, invalid counts, duplicate/unknown clauses and ambiguous endings", () => {
    expect(() => recurrenceRule({ ...form, mode: "weekly" }, event.start, zone)).toThrow();
    for (const rule of ["FREQ=WEEKLY;BYDAY=XX", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;COUNT=1001", "FREQ=DAILY;COUNT=1;UNTIL=20261112T235959Z", "FREQ=DAILY;FREQ=WEEKLY", "FREQ=DAILY;COUNT=2=3"]) expect(() => parseRecurrence(rule)).toThrow();
  });
  it("PL-04/AT-12 monthly count includes clamped occurrences", () => {
    expect(occurrences({ start: "2026-01-31T03:00Z", end: "2026-01-31T04:00Z", recurrenceRule: "FREQ=MONTHLY;COUNT=2" }, date("2026-01-01"), date("2026-07-01"), zone).map(e => e.start.slice(0,10))).toEqual(["2026-01-31", "2026-02-28"]);
  });
});
describe("notification presentation", () => {
  it("includes authorized source, client, property and local deadline", () => {
    const text = notificationText("task", { title: "Уточнить бюджет", client: "Синтетический клиент", property: "Тестовый адрес", at: event.start }, zone);
    expect(text.title).toBe("Срок задачи · Уточнить бюджет · Синтетический клиент · Тестовый адрес");
    expect(text.detail).toContain("10:00");
    expect(notificationText("task", {}, zone)).toEqual({ title: "Срок задачи", detail: "" });
  });
  it("groups by local day and kind, preserving every source and read state", () => {
    const items = [
      { id: "1", kind: "task", triggerAt: "2026-11-05T16:59:00Z", state: "read" },
      { id: "2", kind: "task", triggerAt: "2026-11-05T17:01:00Z", state: "delivered" },
      { id: "3", kind: "task", triggerAt: "2026-11-06T03:00:00Z", state: "delivered" },
      { id: "4", kind: "showing", triggerAt: "2026-11-06T03:00:00Z", state: "delivered" },
    ];
    const groups = groupNotifications(items, zone);
    expect(groups.map(g => g.items.length)).toEqual([1, 2, 1]);
    expect(groups.flatMap(g => g.items).filter(n => n.state === "delivered")).toHaveLength(3);
  });
});
describe("today counter boundaries", () => {
  const now = date("2026-11-05T10:00Z"), tomorrow = date("2026-11-05T17:00Z"), weekEnd = date("2026-11-12T17:00Z");
  const task = { status: "planned", taskType: "call_or_contact", dueAt: now };
  it("uses nonoverlapping buckets at the deadline and local midnight", () => {
    expect(todayTaskBucket({ ...task, dueAt: new Date(+now - 1) }, now, tomorrow, weekEnd)).toBe("overdue");
    expect(todayTaskBucket(task, now, tomorrow, weekEnd)).toBe("today");
    expect(todayTaskBucket({ ...task, dueAt: tomorrow }, now, tomorrow, weekEnd)).toBe("week");
    expect(todayTaskBucket({ ...task, dueAt: weekEnd }, now, tomorrow, weekEnd)).toBeNull();
  });
  it("ignores completed tasks and showing helper duplicates", () => {
    expect(todayTaskBucket({ ...task, status: "completed" }, now, tomorrow, weekEnd)).toBeNull();
    expect(todayTaskBucket({ ...task, taskType: "showing_or_meeting", showingLinks: [{}] }, now, tomorrow, weekEnd)).toBeNull();
    expect(todayTaskBucket({ ...task, taskType: "showing_or_meeting", showingLinks: [] }, now, tomorrow, weekEnd)).toBe("today");
  });
});
