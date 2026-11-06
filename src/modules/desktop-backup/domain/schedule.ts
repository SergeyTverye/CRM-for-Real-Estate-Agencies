import type { BackupSettingsState } from "./settings";

/** A persisted local-calendar slot coalesces every missed interval into one run.
 * DST repeated hours share a slot; nonexistent hours run on the next tick. */
export function dueBackupSlot(schedule: BackupSettingsState["schedule"], now: Date, lastSlot: string | null): string | null {
  if (!schedule.enabled) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (key: string) => Number(parts.find(p => p.type === key)!.value);
  const day = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  if (get("hour") * 60 + get("minute") < schedule.hour * 60 + schedule.minute) day.setUTCDate(day.getUTCDate() - 1);
  if (schedule.frequency === "weekly") day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - schedule.weekday + 7) % 7);
  const slot = `${day.toISOString().slice(0, 10)}T${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}|${schedule.timeZone}|${schedule.frequency}`;
  return slot === lastSlot ? null : slot;
}
