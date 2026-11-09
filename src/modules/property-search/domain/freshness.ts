import { z } from "zod";
const day = z.iso.date();
export const freshnessSchema = z.object({ mode: z.enum(["published", "first_seen"]), period: z.enum(["24h", "3", "7", "30", "90", "custom"]), from: day.optional(), to: day.optional(), includeUnknown: z.boolean().default(false) }).strict().superRefine((v, ctx) => {
  if (v.period === "custom" && (!v.from || !v.to || v.from > v.to)) ctx.addIssue({ code: "custom", message: "Укажите корректные границы дат" });
});
export type Freshness = z.infer<typeof freshnessSchema>;
const DAY = 86400000;

export function freshnessBounds(filter: Freshness, now = new Date()): { from: Date; to: Date } {
  if (filter.period === "24h") return { from: new Date(+now - DAY), to: now };
  const today = new Date(+now + 7 * 3600000).toISOString().slice(0, 10);
  const midnight = (s: string) => Date.parse(`${s}T00:00:00+07:00`);
  return filter.period === "custom" ? { from: new Date(midnight(filter.from!)), to: new Date(midnight(filter.to!) + DAY) }
    : { from: new Date(midnight(today) - (Number(filter.period) - 1) * DAY), to: new Date(midnight(today) + DAY) };
}
export function freshnessState(at: string | Date | null | undefined, filter: Freshness, now = new Date()): "matched" | "contradicted" | "unknown" {
  if (!at || !Number.isFinite(+new Date(at))) return "unknown";
  const bounds = freshnessBounds(filter, now), date = +new Date(at);
  return date >= +bounds.from && (filter.period === "24h" ? date <= +bounds.to : date < +bounds.to) ? "matched" : "contradicted";
}
