import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDesktopDatabase } from "../../scripts/desktop/init-db";
import { createSqliteClient } from "@/shared/db/sqlite-client";
import { resetConfigCache } from "@/shared/config/env";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs(); resetConfigCache();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("real desktop --initialize path seeds fresh and already initialized profiles on repeated launch, without credentials or AI enabled", async () => {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "crm-tariff-bootstrap-"));
  roots.push(directory);
  vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop");
  vi.stubEnv("CRM_DESKTOP_SUPERVISED_UPGRADE", "1");
  vi.stubEnv("AI_ENABLED", "false"); vi.stubEnv("YANDEX_CLOUD_API_KEY", "");
  resetConfigCache();
  const fresh = await initializeDesktopDatabase({ directory });
  expect(fresh).toMatchObject({ created: true, setupRequired: true });
  const client = createSqliteClient("file:" + fresh.file);
  try {
    expect(await client.aiTariff.count()).toBe(6);
    expect(await client.aiSetting.count()).toBe(0); // No hidden AI opt-in.
    expect(await client.aiUsageLog.count()).toBe(0);
    // Simulate the confirmed installed state: account already exists, catalog empty.
    await client.user.create({ data: { login: "synthetic-initialized", displayName: "Synthetic", roleCode: "manager", passwordHash: "synthetic-not-a-login-hash" } });
    await client.aiTariff.deleteMany();
  } finally { await client.$disconnect(); }
  expect(await initializeDesktopDatabase({ directory })).toMatchObject({ created: false, setupRequired: false });
  const installed = createSqliteClient("file:" + fresh.file);
  try {
    const before = await installed.aiTariff.findMany({ orderBy: { id: "asc" } });
    expect(before).toHaveLength(6);
    await installed.aiTariff.create({ data: { model: "custom/latest", callType: "parse", unit: "input_million_tokens", priceRub: "17", effectiveFrom: new Date("2020-01-01Z") } });
  } finally { await installed.$disconnect(); }
  const snapshot = createSqliteClient("file:" + fresh.file);
  let before: Awaited<ReturnType<typeof snapshot.aiTariff.findMany>>;
  try { before = await snapshot.aiTariff.findMany({ orderBy: { id: "asc" } }); } finally { await snapshot.$disconnect(); }
  await initializeDesktopDatabase({ directory });
  const repeated = createSqliteClient("file:" + fresh.file);
  try {
    expect(await repeated.aiTariff.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await repeated.user.count()).toBe(1);
    expect(await repeated.aiUsageLog.count()).toBe(0);
    expect(await repeated.aiBudgetReservation.count()).toBe(0);
  } finally { await repeated.$disconnect(); }
});
