import type { Code } from "@/shared/codebook";
import { occurrences, parseRecurrence } from "@/modules/calendar/domain/calendar-rules";
import { localDateString } from "@/shared/time";

export function nextTaskDue(task: { dueAt: Date; recurrenceKind: string; recurrenceInterval: number; recurrenceUntil: Date | null; recurrenceRule?: string | null }, timeZone: string): Date | null {
  const rule = parseRecurrence(task.recurrenceRule);
  const occurrence = rule ? occurrences({ start: task.dueAt.toISOString(), recurrenceRule: task.recurrenceRule }, task.dueAt, new Date(+task.dueAt + 366 * 366 * 86400000), timeZone, 1)[0] : null;
  const next = rule ? occurrence ? new Date(occurrence.start) : null : nextRecurrenceDue(task.dueAt, task.recurrenceKind as Code<"recurrenceKind">, task.recurrenceInterval, task.recurrenceUntil);
  return next && (!task.recurrenceUntil || localDateString(next,timeZone) <= task.recurrenceUntil.toISOString().slice(0,10)) ? next : null;
}

export const OPEN_TASK_STATUSES = ["planned", "in_progress"] as const;

export function isOpenTaskStatus(status: string): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(status);
}

function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}


export function nextRecurrenceDue(
  dueAt: Date,
  kind: Code<"recurrenceKind">,
  interval: number,
  until: Date | null,
): Date | null {
  const n = Math.max(1, interval);
  let next: Date;
  switch (kind) {
    case "none":
      return null;
    case "daily":
      next = new Date(dueAt.getTime() + n * 86_400_000);
      break;
    case "weekly":
      next = new Date(dueAt.getTime() + n * 7 * 86_400_000);
      break;
    case "monthly":
      next = addMonthsClamped(dueAt, n);
      break;
    case "yearly":
      next = addMonthsClamped(dueAt, 12 * n);
      break;
  }
  if (until) {
    
    const untilEnd = until.getTime() + 86_400_000;
    if (next.getTime() >= untilEnd) return null;
  }
  return next;
}


export type TodayGroup = "calls" | "meetings" | "offers" | "documents" | "advertising" | "other";

export function todayGroupOf(taskType: string): TodayGroup {
  switch (taskType) {
    case "call_or_contact":
      return "calls";
    case "showing_or_meeting":
      return "meetings";
    case "commercial_offer":
      return "offers";
    case "document":
    case "contract_check":
      return "documents";
    case "advertising_check":
      return "advertising";
    default:
      return "other";
  }
}

export const TODAY_GROUP_LABELS: Record<TodayGroup, string> = {
  calls: "Звонки и контакты",
  meetings: "Встречи и показы",
  offers: "Коммерческие предложения",
  documents: "Документы и договоры",
  advertising: "Контроль рекламы",
  other: "Прочие задачи",
};
