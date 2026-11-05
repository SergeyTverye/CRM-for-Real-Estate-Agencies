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
  const match = /^(?:RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY)(?:;UNTIL=(\d{8}T\d{6}Z))?$/.exec(rule);
  if (!match) throw new Error("Поддерживаются FREQ=DAILY/WEEKLY/MONTHLY;UNTIL=YYYYMMDDTHHmmssZ");
  const s = match[2];
  const until = s ? new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`) : null;
  if (until && (!Number.isFinite(+until) || until.toISOString().replace(/[-:]/g, "").replace(".000", "") !== s)) throw new Error("Некорректная дата UNTIL");
  return { frequency: match[1]!, until };
}

export function occurrences(event: Interval & { recurrenceRule?: string | null }, from: Date, to: Date, timeZone: string) {
  const start = new Date(event.start), end = event.end ? new Date(event.end) : start;
  const recurrence = parseRecurrence(event.recurrenceRule);
  const result: { start: string; end: string }[] = [];
  const duration = +end - +start;
  const until = recurrence?.until ? Math.min(+to, +recurrence.until + 1) : +to;
  const local = new Date(`${toDateTimeLocalValue(start, timeZone)}:00Z`);
  const first = recurrence ? Math.max(0, recurrence.frequency === "MONTHLY"
    ? (from.getUTCFullYear() - local.getUTCFullYear()) * 12 + from.getUTCMonth() - local.getUTCMonth() - 2
    : Math.floor((+from - +start - duration) / (86400000 * (recurrence.frequency === "WEEKLY" ? 7 : 1))) - 2) : 0;
  for (let index = first; index < first + 10000; index++) {
    const date = new Date(local);
    if (recurrence?.frequency === "MONTHLY") {
      date.setUTCMonth(local.getUTCMonth() + index, 1);
      date.setUTCDate(local.getUTCDate());
      if (date.getUTCDate() !== local.getUTCDate()) continue;
    } else date.setUTCDate(local.getUTCDate() + index * (recurrence?.frequency === "WEEKLY" ? 7 : 1));
    const at = recurrence ? new Date(+new Date(fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone)) + start.getUTCSeconds()*1000 + start.getUTCMilliseconds()) : start;
    if (+at >= until) break;
    if (+at + duration > +from) result.push({ start: at.toISOString(), end: new Date(+at + duration).toISOString() });
    if (!recurrence) break;
  }
  return result;
}

export function canReadEventDetails(actorId: string, event: { ownerUserId: string; visibility: string }) {
  return actorId === event.ownerUserId || event.visibility === "public";
}
