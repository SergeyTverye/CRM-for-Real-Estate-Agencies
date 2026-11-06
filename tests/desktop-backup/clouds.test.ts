import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { v2 as webdav } from "webdav-server";
import { CreateBucketCommand, ListMultipartUploadsCommand, S3Client } from "@aws-sdk/client-s3";
import { fixture, passphrase, validator } from "./fixtures";
import { YandexS3 } from "../../src/modules/desktop-backup/infrastructure/yandex-s3";
import { MailruWebDav } from "../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import { LocalDir } from "../../src/modules/desktop-backup/infrastructure/local-destination";
import { ReplicationQueue } from "../../src/modules/desktop-backup/application/replication-queue";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { atomicJson, hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import type { BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";
const roots: string[] = [];
const servers: Server[] = [];
let dav: MailruWebDav;
let davFallback: MailruWebDav;
let davEndpoint: string;
let s3: YandexS3;
let admin: S3Client;
let minioEndpoint: string;
let minioContainer: string | undefined;
const minioImage = process.env.DESKTOP_MINIO_IMAGE ?? "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";
const runMinio = process.env.DESKTOP_MINIO_TEST === "1";
const credentials = { accessKeyId: "synthetic-admin", secretAccessKey: "synthetic-secret-for-local-tests" };
const bucket = "synthetic-backups";
const unavailable: BackupDestination = { id: "offline", async put() { throw new Error("synthetic offline"); }, async list() { return []; }, async get() { throw new Error("offline"); }, async delete() {}, async verify() { throw new Error("offline"); } };
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server); return "http://127.0.0.1:" + (server.address() as { port: number }).port; }
async function restored(destination: BackupDestination, a: Awaited<ReturnType<typeof fixture>>, suffix: string) {
  const downloaded = path.join(a.root, "download-" + suffix); await destination.get(a.archive.backupId, downloaded);
  expect(await hashFile(downloaded)).toEqual(await hashFile(a.path));
  const store = new GenerationStore(path.join(a.root, "restored-" + suffix));
  const result = await restoreArchive({ archivePath: downloaded, credential: { passphrase }, schemaVersion: 1, validator, store, confirmed: true, hooks: { withStoppedRuntime: fn => fn(), async protectCurrent() { return { path: a.path, archive: a.archive, credential: { passphrase } }; }, async prepareStage() {} } });
  expect(await readFile(path.join(result.activePath, "documents/sample.txt"), "utf8")).toBe("synthetic document");
}
beforeAll(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-cloud-test-")); roots.push(root);
  const users = new webdav.SimpleUserManager(); const user = users.addUser("synthetic@example.invalid", "synthetic-app-password", false);
  const privileges = new webdav.SimplePathPrivilegeManager(); privileges.setRights(user, "/", ["all"]);
  const davServer = new webdav.WebDAVServer({ hostname: "127.0.0.1", port: 0, httpAuthentication: new webdav.HTTPBasicAuthentication(users), privilegeManager: privileges });
  await davServer.setFileSystemAsync("/", new webdav.VirtualFileSystem());
  const server = await new Promise<Server>(resolve => davServer.start(s => resolve(s!)));
  servers.push(server); davEndpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const options = { endpoint: davEndpoint, allowLocalHttp: true, prefix: "synthetic/installation", email: "synthetic@example.invalid", applicationPassword: "synthetic-app-password", workRoot: root, partBytes: 1024 * 1024 };
  dav = new MailruWebDav({ ...options, id: "dav" }); davFallback = new MailruWebDav({ ...options, id: "dav-fallback", prefix: "synthetic/fallback", useMove: false });
  if (runMinio) {
    const name = "crm-backup-minio-" + randomUUID(); minioContainer = name;
    execFileSync("docker", ["run", "--rm", "-d", "--name", name, "-p", "127.0.0.1::9000", "-e", "MINIO_ROOT_USER=" + credentials.accessKeyId, "-e", "MINIO_ROOT_PASSWORD=" + credentials.secretAccessKey, minioImage, "server", "/data"], { stdio: "pipe", timeout: 90000 });
    const port = execFileSync("docker", ["port", name, "9000/tcp"], { encoding: "utf8", timeout: 10000 }).trim().split(":").at(-1);
    minioEndpoint = "http://127.0.0.1:" + port;
    for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(minioEndpoint + "/minio/health/ready")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    admin = new S3Client({ endpoint: minioEndpoint, region: "us-east-1", credentials, forcePathStyle: true });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    s3 = new YandexS3({ id: "s3", bucket, prefix: "synthetic/installation", workRoot: root, credentials, endpoint: minioEndpoint, region: "us-east-1", allowLocalHttp: true, partBytes: 5 * 1024 ** 2 });
  }
});
afterAll(async () => {
  s3?.close(); admin?.destroy();
  for (const server of servers.reverse()) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  if (minioContainer) { try { execFileSync("docker", ["stop", "--time", "3", minioContainer], { stdio: "pipe", timeout: 15000 }); } catch {} }
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
describe("WebDAV and persistent replication", () => {
  it("multipart, MOVE and no-MOVE fallback restore identical archive; list/delete", async () => {
    const a = await fixture(2 * 1024 ** 2); roots.push(a.root);
    for (const destination of [dav, davFallback]) {
      await destination.put(a.archive, a.path); await destination.verify(a.archive); await destination.put(a.archive, a.path);
      expect((await destination.list()).find(b => b.backupId === a.archive.backupId)?.sha256).toBe(a.archive.sha256);
      await restored(destination, a, destination.id);
      await destination.delete(a.archive.backupId); expect((await destination.list()).find(b => b.backupId === a.archive.backupId)).toBeUndefined();
    }
  });
  it("partial destination failure, network recovery, idempotent queue restart and bounded retry", async () => {
    const a = await fixture(); roots.push(a.root); const queueDir = path.join(a.root, "queue"); const local = new LocalDir("local", path.join(a.root, "destination"));
    const q = new ReplicationQueue(queueDir, [local, unavailable], { baseBackoffMs: 1, maxAttempts: 2 });
    await q.enqueue(a.archive, a.path); const rows = await q.pump(100);
    expect(rows.map(r => r.status)).toEqual(["verified", "failed"]);
    const recovered: BackupDestination = { ...unavailable, async put(ref, file) { await dav.put(ref, file); }, async verify(ref) { await dav.verify(ref); } };
    const restarted = new ReplicationQueue(queueDir, [local, recovered], { baseBackoffMs: 1, maxAttempts: 2 });
    expect((await restarted.pump(100))[1]?.status).toBe("failed");
    expect((await restarted.pump(102)).map(r => r.status)).toEqual(["verified", "verified"]);
    expect((await restarted.pump(200)).map(r => r.attempts)).toEqual([1, 2]);
    await restored(dav, a, "recovered-network");
  });
  it("crash while uploaded resumes without duplicate; queue capacity rejects excess", async () => {
    const a = await fixture(); roots.push(a.root); const queueDir = path.join(a.root, "crash");
    const queue = new ReplicationQueue(queueDir, [dav]); await queue.enqueue(a.archive, a.path);
    const rows = await queue.snapshot(); rows[0]!.status = "uploaded"; await dav.put(a.archive, a.path);
    await atomicJson(path.join(queueDir, "backup-replication-v1.json"), { version: 1, rows });
    const restart = new ReplicationQueue(queueDir, [dav]); expect((await restart.pump())[0]?.status).toBe("verified");
    expect((await dav.list()).filter(r => r.backupId === a.archive.backupId)).toHaveLength(1);
    await expect(new ReplicationQueue(path.join(a.root, "tiny"), [dav], { maxPendingBytes: 1 }).enqueue(a.archive, a.path)).rejects.toThrow("QUEUE_CAPACITY");
    const exhausted = new ReplicationQueue(path.join(a.root, "exhausted"), [unavailable], { maxAttempts: 1, baseBackoffMs: 1 }); await exhausted.enqueue(a.archive, a.path);
    await exhausted.pump(1); expect((await exhausted.pump(100))[0]?.attempts).toBe(1);
    await exhausted.retry(a.archive.backupId, "offline"); expect((await exhausted.snapshot())[0]?.status).toBe("queued");
  });
  it("interrupted WebDAV never publishes a complete marker; retry restores", async () => {
    const a = await fixture(2 * 1024 ** 2); roots.push(a.root); const abort = new AbortController(); let cut = false;
    const proxy = createServer((req, res) => {
      if (!cut && req.method === "PUT" && req.url?.includes("part-1.pending")) {
        cut = true; req.once("data", () => { req.destroy(); res.destroy(); abort.abort(); }); return;
      }
      const upstream = request(new URL(req.url!, davEndpoint), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode!, response.headers); response.pipe(res); });
      upstream.on("error", () => res.destroy()); req.pipe(upstream);
    });
    const endpoint = await listen(proxy);
    const broken = new MailruWebDav({ id: "broken", endpoint, allowLocalHttp: true, prefix: "synthetic/interrupted", email: "synthetic@example.invalid", applicationPassword: "synthetic-app-password", workRoot: a.root, partBytes: 1024 * 1024, useMove: false });
    await expect(broken.put(a.archive, a.path, abort.signal)).rejects.toThrow(); expect(cut).toBe(true);
    expect((await broken.list()).some(r => r.backupId === a.archive.backupId)).toBe(false);
    await broken.put(a.archive, a.path); await restored(broken, a, "dav-interrupted");
  });
});
describe.runIf(runMinio)("S3 compatible MinIO (isolated temporary Docker container)", () => {
  it("immutable PUT/multipart, independent dual replication, CAS, private objects and restore", async () => {
    const a = await fixture(7 * 1024 ** 2); roots.push(a.root);
    const queue = new ReplicationQueue(path.join(a.root, "dual-queue"), [s3, dav, unavailable]);
    await queue.enqueue(a.archive, a.path);
    expect((await queue.pump()).map(r => r.status)).toEqual(["verified", "verified", "failed"]);
    await s3.put(a.archive, a.path);
    expect((await s3.list()).find(r => r.backupId === a.archive.backupId)?.sha256).toBe(a.archive.sha256);
    await restored(s3, a, "s3"); await restored(dav, a, "dav-dual");
    const privateResponse = await fetch(minioEndpoint + "/" + bucket + "/synthetic/installation/" + a.archive.backupId + ".crmbackup");
    expect(privateResponse.status).toBe(403);
    const marker = { deploymentId: a.manifest.deploymentId, instanceId: a.manifest.instanceId, snapshotRevision: 1, backupId: a.archive.backupId };
    const etag = await s3.compareAndSetOwnership(marker, null);
    expect((await s3.readOwnership())?.etag).toBe(etag);
    await expect(s3.compareAndSetOwnership(marker, null)).rejects.toThrow("OWNERSHIP_CONFLICT");
    await expect(s3.compareAndSetOwnership(marker, '"wrong"')).rejects.toThrow("OWNERSHIP_CONFLICT");
    await s3.compareAndSetOwnership({ ...marker, snapshotRevision: 2 }, etag);
  });
  it("connection cut mid multipart aborts server upload; persistent queue resumes and restores", async () => {
    const a = await fixture(11 * 1024 ** 2); roots.push(a.root); let cut = false; const abort = new AbortController();
    const proxy = createServer((req, res) => {
      const url = new URL(req.url!, minioEndpoint);
      if (!cut && req.method === "PUT" && url.searchParams.get("partNumber") === "2") {
        cut = true; req.once("data", () => { req.destroy(); res.destroy(); abort.abort(); }); return;
      }
      const upstream = request(url, { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode!, response.headers); response.pipe(res); });
      upstream.on("error", () => res.destroy()); req.pipe(upstream);
    });
    const endpoint = await listen(proxy);
    const destination = new YandexS3({ id: "s3-cut", bucket, prefix: "synthetic/interrupted", workRoot: path.join(a.root, "s3-work"), credentials, endpoint, region: "us-east-1", allowLocalHttp: true, partBytes: 5 * 1024 ** 2 });
    try {
      const dir = path.join(a.root, "queue-cut"); const q = new ReplicationQueue(dir, [destination], { baseBackoffMs: 1 });
      await q.enqueue(a.archive, a.path); expect((await q.pump(100, abort.signal))[0]?.status).toBe("failed"); expect(cut).toBe(true);
      const uploads = await admin.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: "synthetic/interrupted" }));
      expect(uploads.Uploads ?? []).toHaveLength(0);
      const restart = new ReplicationQueue(dir, [destination], { baseBackoffMs: 1 });
      expect((await restart.pump(102))[0]?.status).toBe("verified");
      await restored(destination, a, "s3-cut");
    } finally { destination.close(); }
  });
});
