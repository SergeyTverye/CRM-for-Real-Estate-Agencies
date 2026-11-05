import { describe, expect, it } from "vitest";
import { plannerTone, mergeDayAggregates } from "@/modules/calendar/domain/planner-rules";
import { occurrences, parseRecurrence } from "@/modules/calendar/domain/calendar-rules";
import { recurrenceForm, recurrenceRule } from "@/modules/calendar/domain/recurrence-form";
const zone = "Asia/Novosibirsk", now = new Date("2026-11-05T03:00:00Z");
describe("PL-02 colors independent of business priority", () => {
  it("uses exact configurable threshold and terminal states win over critical", () => {
    expect(plannerTone("planned",new Date(+now-1),"low",now)).toBe("red");
    expect(plannerTone("planned",new Date(+now+24*3600000),"high",now)).toBe("yellow");
    expect(plannerTone("planned",new Date(+now+24*3600000+1),"high",now)).toBe("green");
    expect(plannerTone("planned",new Date(+now+2*3600000),"normal",now,1)).toBe("green");
    expect(plannerTone("planned",new Date(+now+99*3600000),"critical",now)).toBe("red");
    for (const status of ["completed","cancelled","no_show"]) expect(plannerTone(status,new Date(+now-1),"critical",now)).toBe("gray");
  });
  it("merges daily SQL/recurrence counters without losing colors", () => {
    expect(mergeDayAggregates([{ day:"2026-11-06",total:1,red:1,yellow:0,green:0,gray:0 },{ day:"2026-11-06",total:2,red:0,yellow:1,green:0,gray:1 }])).toEqual([{ day:"2026-11-06",total:3,red:1,yellow:1,green:0,gray:1 }]);
  });
});
describe("PL-04 recurrence", () => {
  it("expands quarter across year boundary and counts an inclusive final occurrence", () => {
    const rows = occurrences({ start:"2026-11-05T03:00Z",recurrenceRule:"FREQ=MONTHLY;INTERVAL=3;COUNT=3" },new Date("2026-01-01"),new Date("2028-01-01"),zone);
    expect(rows.map(r => r.start.slice(0,10))).toEqual(["2026-11-05","2027-02-05","2027-05-05"]);
    expect(occurrences({ start:"2026-11-05T03:00Z",recurrenceRule:"FREQ=YEARLY;UNTIL=20271105T030000Z" },now,new Date("2029-01-01"),zone).map(r => r.start.slice(0,10))).toEqual(["2027-11-05"]);
  });
  it("clamps leap anniversaries to Feb 28 and handles series end", () => {
    expect(occurrences({ start:"2024-02-29T03:00Z",recurrenceRule:"FREQ=YEARLY;COUNT=2" },new Date("2024-01-01"),new Date("2030-01-01"),zone).map(r => r.start.slice(0,10))).toEqual(["2024-02-29","2025-02-28"]);
    expect(occurrences({ start:now.toISOString(),recurrenceRule:"FREQ=YEARLY;COUNT=1" },now,new Date("2030-01-01"),zone)).toEqual([]);
  });
  it("roundtrips quarterly and yearly forms", () => {
    for (const mode of ["quarterly","yearly"] as const) {
      const form = { mode,days:[],end:"count" as const,until:"",count:3 };
      expect(recurrenceForm(recurrenceRule(form,now.toISOString(),zone),zone)).toEqual(form);
    }
    for (const rule of ["FREQ=MONTHLY;INTERVAL=0","FREQ=YEARLY;INTERVAL=999","FREQ=YEARLY;BYDAY=MO"]) expect(() => parseRecurrence(rule)).toThrow();
  });
});
