import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/shared/time";

export type Interval = { start: string; end?: string | null };
export type CalendarItem = Interval & {
  id: string; sourceId?: string; type: "task" | "showing" | "agreement" | "calendar_event";
  title: string; description?: string | null; allDay?: boolean; status: string;
  ownerUserId: string; updatedAt?: string; editable: boolean; url?: string; recurrenceRule?: string | null;
};
export function privateProjection(item: CalendarItem): CalendarItem {
  return { id: item.id, type: "calendar_event", title: "Занято", start: item.start, end: item.end,
    allDay: item.allDay, ownerUserId: item.ownerUserId, status: "busy", editable: false };
}
export function freeIntervals(start: Date, end: Date, events: Interval[]) {
  const busy = events.filter(e => e.end).map(e => [Math.max(+start, +new Date(e.start)), Math.min(+end, +new Date(e.end!))])
    .filter(([a, b]) => b! > a!).sort((a, b) => a[0]! - b[0]!);
  const result: { start: string; end: string }[] = [];
  let cursor = +start;
  for (const [a, b] of busy) {
    if (a! > cursor) result.push({ start: new Date(cursor).toISOString(), end: new Date(a!).toISOString() });
    cursor = Math.max(cursor, b!);
  }
  if (cursor < +end) result.push({ start: new Date(cursor).toISOString(), end: end.toISOString() });
  return result;
}

// Deliberately small RRULE subset. Unknown clauses must never be silently ignored.
export function parseRecurrence(rule: string | null | undefined) {
  if (!rule) return null;
  const parts = rule.replace(/^RRULE:/, "").split(";");
  const fields = new Map(parts.map(p => p.split("=")) as [string, string][]);
  const frequency = fields.get("FREQ");
  const days = fields.get("BYDAY")?.split(",");
  const count = fields.has("COUNT") ? Number(fields.get("COUNT")) : null;
  if (fields.size !== parts.length || parts.some(p => !/^[A-Z]+=[A-Z0-9,]+$/.test(p)) ||
    [...fields.keys()].some(k => !["FREQ", "BYDAY", "UNTIL", "COUNT"].includes(k)) ||
    !["DAILY", "WEEKLY", "MONTHLY"].includes(frequency ?? "") ||
    (days && (frequency !== "WEEKLY" || days.some(d => !WEEK_DAYS.includes(d)) || new Set(days).size !== days.length)) ||
    (count !== null && (!Number.isInteger(count) || count < 1 || count > 1000)) || (count !== null && fields.has("UNTIL")))
    throw new Error("Выберите корректное повторение и окончание серии (от 1 до 1000 повторений)");
  const s = fields.get("UNTIL");
  if (s && !/^\d{8}T\d{6}Z$/.test(s)) throw new Error("Некорректная дата окончания серии");
  const until = s ? new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`) : null;
  if (until && (!Number.isFinite(+until) || until.toISOString().replace(/[-:]/g, "").replace(".000", "") !== s)) throw new Error("Некорректная дата UNTIL");
  return { frequency: frequency!, until, days, count };
}

export const WEEK_DAYS: string[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function occurrences(event: Interval & { recurrenceRule?: string | null }, from: Date, to: Date, timeZone: string) {
  const start = new Date(event.start), end = event.end ? new Date(event.end) : start;
  const recurrence = parseRecurrence(event.recurrenceRule);
  const result: { start: string; end: string }[] = [];
  const duration = +end - +start;
  const until = recurrence?.until ? Math.min(+to, +recurrence.until + 1) : +to;
  const local = new Date(`${toDateTimeLocalValue(start, timeZone)}:00Z`);
  const first = recurrence && !recurrence.count ? Math.max(0, recurrence.frequency === "MONTHLY"
    ? (from.getUTCFullYear() - local.getUTCFullYear()) * 12 + from.getUTCMonth() - local.getUTCMonth() - 2
    : Math.floor((+from - +start - duration) / (86400000 * (recurrence.frequency === "WEEKLY" && !recurrence.days ? 7 : 1))) - 2) : 0;
  let emitted = 0;
  for (let index = first; index < first + 366000; index++) {
    const date = new Date(local);
    if (recurrence?.frequency === "MONTHLY") {
      date.setUTCMonth(local.getUTCMonth() + index, 1);
      date.setUTCDate(local.getUTCDate());
      if (date.getUTCDate() !== local.getUTCDate()) continue;
    } else date.setUTCDate(local.getUTCDate() + index * (recurrence?.frequency === "WEEKLY" && !recurrence.days ? 7 : 1));
    const at = recurrence ? new Date(+new Date(fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone)) + start.getUTCSeconds()*1000 + start.getUTCMilliseconds()) : start;
    if (+at >= until) break;
    if (recurrence?.days && !recurrence.days.includes(WEEK_DAYS[(date.getUTCDay() + 6) % 7]!)) continue;
    if (recurrence?.count && ++emitted > recurrence.count) break;
    if (+at + duration > +from) result.push({ start: at.toISOString(), end: new Date(+at + duration).toISOString() });
    if (!recurrence) break;
  }
  return result;
}

export function canReadEventDetails(actorId: string, event: { ownerUserId: string; visibility: string }) {
  return actorId === event.ownerUserId || event.visibility === "public";
}
