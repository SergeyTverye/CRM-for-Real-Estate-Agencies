import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db, disconnectDb } from "@/shared/db/client";
import { PrismaSessionRepository } from "@/modules/browser-sessions/infrastructure/prisma-repository";
import type { InteractiveSession } from "@/modules/browser-sessions/domain/session";

const ownerId = randomUUID(), runId = randomUUID();
beforeAll(async () => {
  const ready = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.interactive_browser_sessions') IS NOT NULL AS ready`;
  if (!ready[0]?.ready) throw new Error("Apply the model agent's v3.1 migration to the dedicated test database before this test.");
  // Only this test's synthetic rows; no truncate/migrate/generate.
  await db.user.create({ data: { id: ownerId, login: `hitl-${ownerId}`, displayName: "Синтетический HITL-тест", roleCode: "realtor", passwordHash: "disabled-synthetic-account", isActive: false } });
  await db.searchRun.create({ data: { id: runId, userId: ownerId, filters: {}, status: "pending" } });
});
afterAll(async () => {
  try {
    const ready = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.interactive_browser_sessions') IS NOT NULL AS ready`;
    if (ready[0]?.ready) await db.$executeRaw`DELETE FROM interactive_browser_sessions WHERE owner_user_id = ${ownerId}::uuid`;
    await db.searchRun.deleteMany({ where: { id: runId } }); await db.user.deleteMany({ where: { id: ownerId } });
  } finally { await disconnectDb(); }
});
it("PostgreSQL advisory lock serializes independent repositories and preserves session metadata", async () => {
  const repositories = Array.from({ length: 8 }, () => new PrismaSessionRepository());
  const make = (): InteractiveSession => ({ id: randomUUID(), searchRunId: runId, ownerUserId: ownerId, source: "cian", status: "pending", startUrlHost: "www.cian.ru", createdAt: new Date(), lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 60_000), completedAt: null, closeReason: null });
  const candidates = repositories.map(() => make());
  const results = await Promise.all(repositories.map((repo, i) => repo.claim(candidates[i]!)));
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = candidates[results.findIndex(Boolean)]!;
  expect(await repositories[0]!.get(winner.id)).toEqual(winner);
  expect((await repositories[0]!.active(ownerId, "cian"))?.id).toBe(winner.id);
  await repositories[0]!.save({ ...winner, status: "cancelled", completedAt: new Date(), closeReason: "user_cancelled" });
  await repositories[1]!.save({ ...winner, status: "active", lastActivityAt: new Date() });
  expect((await repositories[1]!.get(winner.id))?.status).toBe("cancelled");
  expect(await repositories[1]!.claim(make())).toBe(true);
  // Different source/claim key still shares the durable global Chromium budget.
  await expect(repositories[2]!.claim({ ...make(), source: "avito" }, 1)).rejects.toMatchObject({ code: "BROWSER_CAPACITY" });
});
