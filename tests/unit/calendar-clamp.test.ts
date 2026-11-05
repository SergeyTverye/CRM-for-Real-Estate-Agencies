import { describe, expect, it } from "vitest";
import { occurrences } from "@/modules/calendar/domain/calendar-rules";

const zone = "Asia/Novosibirsk";
const expand = (start: string, rule: string, from: string, to: string) => occurrences({
  start, end: new Date(+new Date(start) + 3600000).toISOString(), recurrenceRule: rule,
}, new Date(from), new Date(to), zone);

describe("PL-04 / AT-12 calendar month-end policy", () => {
  it.each([29, 30, 31])("clamps monthly day %i without drifting or skipping COUNT", day => {
    const dates = expand(`2026-01-${day}T03:00:12.345Z`, "FREQ=MONTHLY;COUNT=4", "2026-01-01", "2026-06-01");
    expect(dates.map(d => d.start)).toEqual([
      `2026-01-${day}T03:00:12.345Z`, "2026-02-28T03:00:12.345Z",
      `2026-03-${day}T03:00:12.345Z`, `2026-04-${Math.min(day, 30)}T03:00:12.345Z`,
    ]);
    expect(dates.every(d => +new Date(d.end) - +new Date(d.start) === 3600000)).toBe(true);
  });
  it("anchors quarterly repeats to January 31 and counts the real four occurrences", () => {
    const rule = "FREQ=MONTHLY;INTERVAL=3;COUNT=4";
    expect(expand("2026-01-31T03:00Z", rule, "2026-01-01", "2027-06-01").map(d => d.start.slice(0, 10)))
      .toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(expand("2026-01-31T03:00Z", rule, "2026-04-01", "2027-06-01").map(d => d.start.slice(0, 10)))
      .toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(expand("2026-01-31T03:00Z", rule, "2027-01-01", "2028-01-01")).toEqual([]);
  });
  it("uses Feb 28 in non-leap years and restores Feb 29 in leap years", () => {
    expect(expand("2024-02-29T03:00Z", "FREQ=YEARLY;COUNT=5", "2024-01-01", "2030-01-01").map(d => d.start.slice(0, 10)))
      .toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });
  it("honors inclusive UNTIL on a clamped date and fast-forwards unbounded series", () => {
    expect(expand("2026-01-31T03:00Z", "FREQ=MONTHLY;INTERVAL=3;UNTIL=20260430T030000Z", "2026-01-01", "2027-01-01").map(d => d.start.slice(0, 10)))
      .toEqual(["2026-01-31", "2026-04-30"]);
    expect(expand("2026-01-31T03:00Z", "FREQ=MONTHLY;INTERVAL=3", "2036-04-01", "2036-11-01").map(d => d.start.slice(0, 10)))
      .toEqual(["2036-04-30", "2036-07-31", "2036-10-31"]);
  });
});
