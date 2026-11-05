/** One instant and disjoint half-open intervals for both header and daily agenda. */
export function todayTaskRanges(now: Date, tomorrow: Date, weekEnd: Date) {
  return { overdue: { lt: now }, today: { gte: now, lt: tomorrow }, upcoming: { gte: tomorrow, lt: weekEnd } };
}

/** Task counters deliberately exclude control dates and duplicate showing helper tasks. */
export function todayTaskBucket(task: { status: string; dueAt: Date; taskType: string; showingLinks?: unknown[] }, now: Date, tomorrow: Date, weekEnd: Date): "overdue" | "today" | "week" | null {
  if (!["planned", "in_progress"].includes(task.status) || (task.taskType === "showing_or_meeting" && task.showingLinks?.length)) return null;
  return task.dueAt < now ? "overdue" : task.dueAt < tomorrow ? "today" : task.dueAt < weekEnd ? "week" : null;
}
