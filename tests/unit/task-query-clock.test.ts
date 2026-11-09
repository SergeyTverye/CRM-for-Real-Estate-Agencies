import { afterEach, expect, it, vi } from "vitest";
import type { Actor } from "@/modules/auth/domain/actor";

const mocks = vi.hoisted(() => ({ task: { findMany: vi.fn(), count: vi.fn() } }));
vi.mock("@/shared/db/client", () => ({ db: { task: mocks.task } }));
vi.mock("react", () => ({ cache: (fn: () => unknown) => {
  let result: unknown;
  return () => result ??= fn();
} }));

import { countTodayTasks, getTodayReferenceTime, listTasks, toTaskView } from "@/modules/tasks/application/task-queries";

afterEach(() => vi.useRealTimers());

it("keeps list filters and row overdue flags on the counter's request clock as wall time advances", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
  const reference = getTodayReferenceTime();
  const actor: Actor = { userId: "realtor1", login: "one", displayName: "One", role: "realtor", sessionId: "session", mustChangePassword: false };
  const task = {
    id: "task", status: "planned", dueAt: new Date(+reference + 1),
    clientLinks: [], needLinks: [], propertyLinks: [], showingLinks: [],
    dealLinks: [], advertisementLinks: [], agreementLinks: [], offerLinks: [],
  } as unknown as Parameters<typeof toTaskView>[1];
  mocks.task.findMany.mockResolvedValue([task]);
  mocks.task.count.mockResolvedValue(0);
  await countTodayTasks(actor);
  expect(mocks.task.count.mock.calls[0]![0].where.dueAt.lt).toEqual(reference);

  vi.setSystemTime(new Date(+reference + 3600000));
  expect(toTaskView(actor, task).overdue).toBe(false);
  expect(toTaskView(actor, task, new Date()).overdue).toBe(true);
  const overdue = await listTasks(actor, { view: "overdue" });
  expect(mocks.task.findMany.mock.calls[0]![0].where.AND).toContainEqual({ dueAt: { lt: reference } });
  expect(overdue.items[0]!.overdue).toBe(false);
  await listTasks(actor, { view: "today" });
  expect(mocks.task.findMany.mock.calls[1]![0].where.AND).toContainEqual({ dueAt: { gte: reference, lt: expect.any(Date) } });
});
