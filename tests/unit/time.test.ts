import { describe, expect, it } from "vitest";
import { fromDateTimeLocalValue, localDateString, startOfDayInTz, toDateTimeLocalValue } from "@/shared/time";

describe("часовой пояс экземпляра", () => {
  it("начало суток в Europe/Moscow (UTC+3)", () => {
    expect(startOfDayInTz(new Date("2026-11-03T22:30:00Z"), "Europe/Moscow").toISOString()).toBe("2026-11-03T21:00:00.000Z");
    expect(startOfDayInTz(new Date("2026-11-03T10:00:00Z"), "Europe/Moscow").toISOString()).toBe("2026-11-02T21:00:00.000Z");
  });
  it("локальная дата", () => expect(localDateString(new Date("2026-11-03T22:30:00Z"), "Europe/Moscow")).toBe("2026-11-04"));
  it("datetime-local туда и обратно", () => {
    const iso = "2026-06-15T07:45:00.000Z";
    expect(toDateTimeLocalValue(iso, "Europe/Moscow")).toBe("2026-06-15T10:45");
    expect(fromDateTimeLocalValue("2026-06-15T10:45", "Europe/Moscow")).toBe(iso);
  });
});
