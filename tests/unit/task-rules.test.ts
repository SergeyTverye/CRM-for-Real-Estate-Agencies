import { describe, expect, it } from "vitest";
import { nextRecurrenceDue, todayGroupOf } from "@/modules/tasks/domain/task-rules";

describe("повторяемые задачи", () => {
  const due = new Date("2026-01-31T09:00:00.000Z");
  it("без повтора — нет следующего экземпляра", () => expect(nextRecurrenceDue(due, "none", 1, null)).toBeNull());
  it("ежемесячно с ограничением конца месяца", () => expect(nextRecurrenceDue(due, "monthly", 1, null)?.toISOString()).toBe("2026-02-28T09:00:00.000Z"));
  it("еженедельно с интервалом 2", () =>
    expect(nextRecurrenceDue(new Date("2026-03-02T07:00:00Z"), "weekly", 2, null)?.toISOString()).toBe("2026-03-16T07:00:00.000Z"));
  it("ежегодно (напоминание о дне рождения)", () =>
    expect(nextRecurrenceDue(new Date("2026-05-10T06:00:00Z"), "yearly", 1, null)?.toISOString()).toBe("2027-05-10T06:00:00.000Z"));
  it("останавливается после recurrence_until", () => {
    expect(nextRecurrenceDue(due, "monthly", 1, new Date("2026-02-28T00:00:00Z"))).not.toBeNull();
    expect(nextRecurrenceDue(due, "monthly", 1, new Date("2026-02-27T00:00:00Z"))).toBeNull();
  });
  it("группировка экрана «Сегодня» по типу", () => {
    expect(todayGroupOf("call_or_contact")).toBe("calls");
    expect(todayGroupOf("showing_or_meeting")).toBe("meetings");
    expect(todayGroupOf("contract_check")).toBe("documents");
    expect(todayGroupOf("postdeal")).toBe("other");
  });
});
