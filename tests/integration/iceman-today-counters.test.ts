import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getShellIndicators } from "@/server/shell-indicators";
import { countTodayTasks, getTodayView } from "@/modules/tasks/application/task-queries";
import { db, resetDatabase, seedBase } from "../helpers/fixtures";
it("uses identical fixed-now counts in header and today, without truncating a large queue", async () => {
  await resetDatabase(); const users = await seedBase(); const now = new Date("2026-11-05T10:00:00Z");
  const base = { responsibleUserId:users.realtor1.userId, createdBy:users.realtor1.userId, taskType:"other", status:"planned", priority:"normal", title:"Синтетическая задача" };
  await db.task.createMany({data:[
    ...Array.from({length:205},()=>({...base,dueAt:new Date(+now-1)})),
    {...base,dueAt:now}, {...base,dueAt:new Date("2026-11-05T17:00:00Z")},
    {...base,dueAt:new Date("2026-11-12T17:00:00Z")},
    {...base,status:"completed",completedAt:now,dueAt:new Date(+now-1)},
    {...base,responsibleUserId:users.realtor2.userId,dueAt:new Date(+now-1)},
  ]});
  const counts = await countTodayTasks(users.realtor1, now);
  const today = await getTodayView(users.realtor1, {}, now);
  const shell = await getShellIndicators(users.realtor1, now);
  expect(counts).toEqual({overdue:205,today:1,upcoming:1});
  expect(shell.overdue).toBe(counts.overdue);
  expect(today.counters).toMatchObject({overdue:counts.overdue,today:counts.today,week:counts.upcoming});
  expect(today.overdue).toHaveLength(200);
});
