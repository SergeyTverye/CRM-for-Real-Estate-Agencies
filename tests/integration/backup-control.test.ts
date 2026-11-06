import { beforeEach, expect, it, afterAll, beforeAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/v1/settings/backups/control/route";
import { GET as DOWNLOAD } from "@/app/api/v1/settings/backups/archives/[backupId]/route";
import { DatabaseReplicationJournal } from "@/modules/desktop-backup/infrastructure/database-journal";
import { ReplicationQueue } from "@/modules/desktop-backup/application/replication-queue";
import { MailruWebDav } from "@/modules/desktop-backup/infrastructure/mailru-webdav";
import { hashFile } from "@/modules/desktop-backup/infrastructure/fs";
import { withBackupDestinations } from "@/modules/desktop-backup/infrastructure/destinations-runtime";
import { JsonSettingsRepository } from "@/modules/desktop-backup/infrastructure/settings-repository";
import { pruneLocalPortable } from "@/modules/desktop-backup/application/local-retention";
import { backupControlCommand } from "@/modules/desktop-backup/application/backup-control";
import { pgDumpValidator } from "@/modules/desktop-backup/application/server-archives";
import { createArchive } from "@/modules/desktop-backup/infrastructure/archive";
import { LocalDir } from "@/modules/desktop-backup/infrastructure/local-destination";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { apiRequest, db, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
const oldSettingsDir = process.env.BACKUP_SETTINGS_DIR;
beforeAll(async () => { const settings = await mkdtemp(path.join(os.tmpdir(), "crm-backup-control-settings-")); roots.push(settings); process.env.BACKUP_SETTINGS_DIR = settings; });
let users: TestUsers; const roots: string[] = []; const servers: Server[] = [];
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
afterAll(async () => { if (oldSettingsDir === undefined) delete process.env.BACKUP_SETTINGS_DIR; else process.env.BACKUP_SETTINGS_DIR = oldSettingsDir; for (const s of servers) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } for (const root of roots) await rm(root, { recursive: true, force: true }); });
it("direct status/commands/archive URLs require manager on either database", async () => {
  const cookie = await sessionCookieFor(users.realtor1);
  expect((await GET(apiRequest("GET", "/api/v1/settings/backups/control", { cookie }), routeParams({}))).status).toBe(403);
  expect((await POST(apiRequest("POST", "/api/v1/settings/backups/control", { cookie, body: { action: "probe", destinationId: randomUUID() } }), routeParams({}))).status).toBe(403);
  const id = randomUUID();
  expect((await DOWNLOAD(apiRequest("GET", `/api/v1/settings/backups/archives/${id}`, { cookie }), routeParams({ backupId: id }))).status).toBe(403);
  const manager = await sessionCookieFor(users.manager);
  expect((await DOWNLOAD(apiRequest("GET", `/api/v1/settings/backups/archives/${id}`, { cookie: manager }), routeParams({ backupId: id }))).status).toBe(404);
  const bad = await POST(apiRequest("POST", "/api/v1/settings/backups/control", { cookie: manager, body: { action: "create", passphrase: "synthetic-never-echo", recoveryKey: "bad", recoveryKeySaved: false } }), routeParams({}));
  expect(bad.status).toBe(400); expect(await bad.text()).not.toContain("synthetic-never-echo");
});
it("durable journal uses compare-and-swap and never exposes source paths", async () => {
  const journal = new DatabaseReplicationJournal(); const before = await journal.read();
  await journal.save(before.revision, []);
  await expect(journal.save(before.revision, [])).rejects.toMatchObject({ code: "QUEUE_REVISION_CONFLICT" });
  expect((await new DatabaseReplicationJournal().read()).revision).toBe(before.revision + 1);
  await db.backupQueueJournal.create({ data: { id: "command:" + randomUUID(), payload: { action: "create", status: "queued", createdAt: new Date().toISOString(), secretRef: "synthetic-private-ref", passphrase: "synthetic-do-not-return" } } });
  const cookie = await sessionCookieFor(users.manager);
  const response = await GET(apiRequest("GET", "/api/v1/settings/backups/control", { cookie }), routeParams({}));
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("sourcePath"); expect(text).not.toContain("synthetic-private-ref"); expect(text).not.toContain("synthetic-do-not-return");
});

it("retention never counts an orphan sidecar as a recoverable generation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-retention-check-")); roots.push(root);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (let i = 0; i < ids.length; i++) {
    const file = path.join(root, ids[i] + ".crmbackup"); await writeFile(file, "synthetic encrypted stream " + i);
    const archive = { backupId: ids[i], createdAtUtc: new Date(Date.now() - i * 86400000).toISOString(), ...await hashFile(file) };
    await writeFile(file + ".json", JSON.stringify({ archive }));
  }
  const missing = randomUUID();
  await writeFile(path.join(root, missing + ".crmbackup.json"), JSON.stringify({ archive: { backupId: missing, createdAtUtc: new Date(Date.now() + 86400000).toISOString(), size: 1, sha256: "a".repeat(64) } }));
  const plan = await pruneLocalPortable(root, { keep: 2, maxAgeDays: 30, maxBytes: 1024 ** 2 });
  expect(plan.deleteIds).toEqual([ids[2]]);
  await expect(hashFile(path.join(root, ids[1] + ".crmbackup"))).resolves.toHaveProperty("size");
});

it.runIf(process.env.CRM_DEPLOYMENT_MODE !== "desktop")("server verify downloads the selected destination rather than checking a local namesake (fake dump validator)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-server-verify-")); roots.push(root);
  const validator = vi.spyOn(pgDumpValidator, "validate").mockResolvedValue(undefined);
  const destinationId = randomUUID(), passphrase = "synthetic remote verify only";
  const repository = new JsonSettingsRepository(process.env.BACKUP_SETTINGS_DIR!);
  const directory = path.join(root, "remote");
  try {
    const created = await createArchive({ databaseKind: "postgres", outputDir: path.join(root, "source"), stagingRoot: path.join(root, "staging"),
      source: { createConsistentSnapshot: file => writeFile(file, "synthetic dump fixture") }, validator: pgDumpValidator, barrier: { run: work => work() },
      metadata: { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null, crmVersion: "synthetic", schemaVersion: 1 },
      passphrase, recoveryKey: newRecoveryKey(), recoveryKeySaved: true, settings: {}, storage: {},
    });
    await new LocalDir(destinationId, directory).put(created.archive, created.path);
    await repository.transaction(async state => ({ state: { ...state, destinations: [{ config: { id: destinationId, kind: "local", enabled: true, directory } }] }, result: undefined }));
    const command = { action: "verify", backupId: created.archive.backupId, destinationId, passphrase };
    await expect(backupControlCommand(users.manager, command)).resolves.toMatchObject({ verified: true, backupId: created.archive.backupId });
    await writeFile(path.join(directory, created.archive.backupId, "archive.crmbackup"), "corrupted synthetic archive");
    await expect(backupControlCommand(users.manager, command)).rejects.toMatchObject({ code: "INFRASTRUCTURE_ERROR" });
  } finally {
    validator.mockRestore();
    await repository.transaction(async state => ({ state: { ...state, destinations: [] }, result: undefined }));
  }
});
it("DB queue survives a worker restart and retries WebDAV after local server recovers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-queue-db-")); roots.push(root);
  const file = path.join(root, "synthetic.crmbackup"); await writeFile(file, "synthetic encrypted stream fixture");
  let online = false; const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    if (!online) { res.writeHead(503).end(); return; }
    const key = req.url!;
    if (req.method === "MKCOL") { res.writeHead(201).end(); return; }
    if (req.method === "PUT") { const buffers: Buffer[] = []; for await (const b of req) buffers.push(Buffer.from(b)); objects.set(key, Buffer.concat(buffers)); res.writeHead(201).end(); return; }
    if (req.method === "GET") { const body = objects.get(key); if (!body) res.writeHead(404).end(); else res.writeHead(200).end(body); return; }
    if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); return; }
    res.writeHead(207, { "content-type": "application/xml" }).end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
  });
  servers.push(server); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const destination = new MailruWebDav({ id: "synthetic-webdav", endpoint, allowLocalHttp: true, email: "synthetic@example.invalid", applicationPassword: "synthetic-only", prefix: "test", useMove: false, workRoot: root });
  const archive = { backupId: randomUUID(), createdAtUtc: new Date().toISOString(), ...await hashFile(file) };
  const first = new ReplicationQueue(root, [destination], { baseBackoffMs: 1 }, new DatabaseReplicationJournal());
  await first.enqueue(archive, file); expect((await first.pump())[0]!.status).toBe("failed");
  online = true;
  const restarted = new ReplicationQueue(root, [destination], { baseBackoffMs: 1 }, new DatabaseReplicationJournal());
  const result = await restarted.pump(Date.now() + 1000);
  expect(result[0]!.status).toBe("verified");
  expect((await new DatabaseReplicationJournal().read()).rows[0]!.attempts).toBe(2);
});

it("unreadable cloud credentials fail only their target; healthy local copy is verified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-backup-isolation-")); roots.push(root);
  const file = path.join(root, "synthetic.crmbackup"); await writeFile(file, "synthetic encrypted archive");
  const cloudId = randomUUID(), localId = randomUUID();
  const repository = new JsonSettingsRepository(process.env.BACKUP_SETTINGS_DIR!);
  await repository.transaction(async state => ({ state: { ...state, destinations: [
    { config: { id: cloudId, kind: "mailru_webdav", enabled: true, email: "synthetic@example.invalid", prefix: "synthetic", endpoint: "https://webdav.cloud.mail.ru", partBytes: 1024 ** 2, useMove: false }, secretRef: randomUUID() },
    { config: { id: localId, kind: "local", enabled: true, directory: path.join(root, "local") } },
  ] }, result: undefined }));
  try {
    const archive = { backupId: randomUUID(), createdAtUtc: new Date().toISOString(), ...await hashFile(file) };
    await withBackupDestinations(async destinations => {
      const queue = new ReplicationQueue(root, destinations, {}, new DatabaseReplicationJournal());
      await queue.enqueue(archive, file);
      const rows = await queue.pump();
      expect(rows.find(r => r.destinationId === cloudId)?.status).toBe("failed");
      expect(rows.find(r => r.destinationId === localId)?.status).toBe("verified");
      expect(await hashFile(path.join(root, "local", archive.backupId, "archive.crmbackup"))).toEqual(await hashFile(file));
    });
  } finally { await repository.transaction(async state => ({ state: { ...state, destinations: [] }, result: undefined })); }
});
