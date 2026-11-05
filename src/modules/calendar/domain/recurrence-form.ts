import { fromDateTimeLocalValue, localDateString } from "@/shared/time";
import { parseRecurrence } from "./calendar-rules";

export type RepeatForm = { mode: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "quarterly" | "yearly"; days: string[]; end: "never" | "date" | "count"; until: string; count: number };
export function recurrenceForm(rule: string | null | undefined, timeZone: string): RepeatForm {
  const r = parseRecurrence(rule);
  return { mode: !r ? "none" : r.frequency === "YEARLY" ? "yearly" : r.frequency === "DAILY" ? "daily" : r.frequency === "MONTHLY" ? r.interval === 3 ? "quarterly" : "monthly" : r.days?.join(",") === "MO,TU,WE,TH,FR" ? "weekdays" : "weekly",
    days: r?.days ?? [], end: r?.until ? "date" : r?.count ? "count" : "never", until: r?.until ? localDateString(r.until, timeZone) : "", count: r?.count ?? 10 };
}
export function recurrenceRule(form: RepeatForm, start: string, timeZone: string): string | null {
  if (form.mode === "none") return null;
  const days = form.mode === "weekdays" ? ["MO", "TU", "WE", "TH", "FR"] : form.days;
  if (form.mode === "weekly" && !days.length) throw new Error("Выберите хотя бы один день недели");
  let rule = `FREQ=${form.mode === "yearly" ? "YEARLY" : ["monthly", "quarterly"].includes(form.mode) ? "MONTHLY" : form.mode === "daily" ? "DAILY" : "WEEKLY"}`;
  if (form.mode === "quarterly") rule += ";INTERVAL=3";
  if (form.mode === "weekdays" || form.mode === "weekly") rule += `;BYDAY=${days.join(",")}`;
  if (form.end === "count") rule += `;COUNT=${form.count}`;
  if (form.end === "date") {
    if (!form.until || form.until < localDateString(new Date(start), timeZone)) throw new Error("Окончание серии должно быть не раньше начала");
    rule += `;UNTIL=${fromDateTimeLocalValue(`${form.until}T23:59`, timeZone).replace(/[-:]/g, "").replace(".000", "").replace(/00Z$/, "59Z")}`;
  }
  parseRecurrence(rule);
  return rule;
}
