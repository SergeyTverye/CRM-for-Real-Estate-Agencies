export type PlannerTone = "red" | "yellow" | "green" | "gray";
export const PLANNER_COLORS: Record<PlannerTone, string> = { red: "#b91c1c", yellow: "#a16207", green: "#15803d", gray: "#64748b" };
export function plannerTone(status: string, at: Date, priority = "normal", now = new Date(), soonHours = 24): PlannerTone {
  if (["completed", "cancelled", "no_show", "archived", "expired", "terminated"].includes(status)) return "gray";
  if (at < now || priority === "critical") return "red";
  return +at - +now <= soonHours * 3600000 ? "yellow" : "green";
}
export type DayAggregate = { day: string; total: number; red: number; yellow: number; green: number; gray: number };
export function mergeDayAggregates(rows: DayAggregate[]): DayAggregate[] {
  const days = new Map<string, DayAggregate>();
  for (const row of rows) {
    const day = days.get(row.day) ?? { day: row.day, total: 0, red: 0, yellow: 0, green: 0, gray: 0 };
    for (const key of ["total", "red", "yellow", "green", "gray"] as const) day[key] += Number(row[key]);
    days.set(row.day, day);
  }
  return [...days.values()].sort((a,b) => a.day.localeCompare(b.day));
}
