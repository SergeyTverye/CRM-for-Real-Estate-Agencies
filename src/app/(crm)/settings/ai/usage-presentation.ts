import type { getAiUsage } from "@/modules/ai/application/settings-service";
import { periodKeys } from "@/modules/ai/domain/gate";
import { rubToMicros } from "@/modules/ai/domain/cost";
type Usage = Awaited<ReturnType<typeof getAiUsage>>;
export function availableBudget(budget: string, committed: string): string {
  const remainder = rubToMicros(budget) - rubToMicros(committed);
  const value = remainder > 0n ? remainder : 0n;
  return `${value / 1000000n}.${String(value % 1000000n).padStart(6, "0")}`;
}
export function todayUsage(items: Usage["items"], now: Date, timeZone: string) {
  const day = periodKeys(now, timeZone).dayKey;
  const rows = items.filter(r => periodKeys(new Date(r.createdAt), timeZone).dayKey === day);
  const users = [...new Set(rows.map(r => r.userId))].map(userId => {
    const calls = rows.filter(r => r.userId === userId);
    return { userId, name: calls[0]!.user, calls: calls.length, webJobs: new Set(calls.filter(r => r.callType === "web_search").map(r => r.jobId)).size };
  });
  return { day, calls: rows.length, users };
}
