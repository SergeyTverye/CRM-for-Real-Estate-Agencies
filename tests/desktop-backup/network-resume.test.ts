import { afterEach, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import type { Socket } from "node:net";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { v2 as webdav } from "webdav-server";
import { fixture, passphrase, validator } from "./fixtures";
import { MailruWebDav } from "../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import { ReplicationQueue } from "../../src/modules/desktop-backup/application/replication-queue";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import { assertArchive } from "../../src/modules/desktop-backup/infrastructure/transfer";
import type { ArchiveRef, BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";

const SECRET = "synthetic-app-password";
const roots: string[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();
const davServers: Array<{ stopAsync: () => Promise<unknown> }> = [];

function track(server: Server): Server {
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  return server;
}

async function startDav(): Promise<string> {
  const users = new webdav.SimpleUserManager();
  const user = users.addUser("synthetic@example.invalid", SECRET, false);
  const privileges = new webdav.SimplePathPrivilegeManager();
  privileges.setRights(user, "/", ["all"]);
  const dav = new webdav.WebDAVServer({
    hostname: "127.0.0.1",
    port: 0,
    httpAuthentication: new webdav.HTTPBasicAuthentication(users),
    privilegeManager: privileges,
  });
  davServers.push(dav as unknown as { stopAsync: () => Promise<unknown> });
  await dav.setFileSystemAsync("/", new webdav.VirtualFileSystem());
  const server = await new Promise<Server>((resolve) => dav.start((s) => resolve(s!)));
  track(server);
  expect(server.listening).toBe(true);
  const address = server.address() as { port: number } | null;
  expect(address?.port).toBeGreaterThan(0);
  const endpoint = "http://127.0.0.1:" + address!.port;
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  return endpoint;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => track(server).listen(0, "127.0.0.1", resolve));
  expect(server.listening).toBe(true);
  const address = server.address() as { port: number } | null;
  expect(address?.port).toBeGreaterThan(0);
  return "http://127.0.0.1:" + address!.port;
}

afterEach(async () => {
  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch {}
  }
  sockets.clear();
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dav of davServers.splice(0).reverse()) {
    try {
      await dav.stopAsync();
    } catch {}
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type DavConfig = {
  endpoint: string;
  prefix: string;
  workRoot: string;
  partBytes?: number;
};

function dav(config: DavConfig): MailruWebDav {
  return new MailruWebDav({
    id: "victim",
    endpoint: config.endpoint,
    allowLocalHttp: true,
    prefix: config.prefix,
    email: "synthetic@example.invalid",
    applicationPassword: SECRET,
    workRoot: config.workRoot,
    partBytes: config.partBytes ?? 256 * 1024,
    useMove: false,
  });
}

function healthyDav(endpoint: string, workRoot: string): MailruWebDav {
  return new MailruWebDav({
    id: "healthy",
    endpoint,
    allowLocalHttp: true,
    prefix: "synthetic/healthy",
    email: "synthetic@example.invalid",
    applicationPassword: SECRET,
    workRoot,
    partBytes: 256 * 1024,
    useMove: false,
  });
}

async function restoredFromId(destination: BackupDestination, backupId: string, sourceHash: Awaited<ReturnType<typeof hashFile>>, root: string, suffix: string, protective: Awaited<ReturnType<typeof fixture>>) {
  const downloaded = path.join(root, "download-" + suffix);
  await destination.get(backupId, downloaded);
  expect(await hashFile(downloaded)).toEqual(sourceHash);
  const store = new GenerationStore(path.join(root, "restored-" + suffix));
  const result = await restoreArchive({
    archivePath: downloaded,
    credential: { passphrase },
    schemaVersion: 1,
    validator,
    store,
    confirmed: true,
    hooks: {
      withStoppedRuntime: (fn) => fn(),
      async protectCurrent() {
        return { path: protective.path, archive: protective.archive, credential: { passphrase } };
      },
      async prepareStage() {},
    },
  });
  expect(await readFile(path.join(result.activePath, "documents/sample.txt"), "utf8")).toBe("synthetic document");
}

type FaultProxy = {
  endpoint: string;
  state: { disrupted: boolean };
  counters: { socketCuts: number; proxyRequests: number; uploadRequests: number };
};

async function startFaultProxy(upstreamEndpoint: string): Promise<FaultProxy> {
  const state = { disrupted: true };
  const counters = { socketCuts: 0, proxyRequests: 0, uploadRequests: 0 };
  expect(upstreamEndpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const proxy = createServer((req, res) => {
    counters.proxyRequests += 1;
    const isUpload = req.method === "PUT" && req.url !== undefined && (req.url.includes("part-") || req.url.includes(".complete.json"));
    if (isUpload) counters.uploadRequests += 1;
    if (state.disrupted && isUpload) {
      counters.socketCuts += 1;
      req.once("data", () => {
        try {
          req.socket.destroy();
        } catch {}
        try {
          res.destroy();
        } catch {}
      });
      req.resume();
      return;
    }
    const forwarded: Record<string, string | string[] | undefined> = { ...req.headers };
    delete forwarded.host;
    delete forwarded.connection;
    delete forwarded["keep-alive"];
    delete forwarded["proxy-connection"];
    delete forwarded["transfer-encoding"];
    delete forwarded.upgrade;
    const upstream = request(
      new URL(req.url!, upstreamEndpoint),
      { method: req.method, headers: forwarded as Record<string, string | string[] | undefined> },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      },
    );
    const destroyUpstream = () => {
      try {
        upstream.destroy();
      } catch {}
    };
    req.on("error", destroyUpstream);
    req.on("aborted", destroyUpstream);
    res.on("close", destroyUpstream);
    upstream.on("error", () => {
      try {
        if (!res.writableEnded) res.destroy();
      } catch {}
    });
    req.pipe(upstream);
  });
  const endpoint = await listen(proxy);
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(proxy.listening).toBe(true);
  return { endpoint, state, counters };
}

const queueOpts = { baseBackoffMs: 10, maxBackoffMs: 50, maxAttempts: 5 } as const;
const INCOMPRESSIBLE_BYTES = 2 * 1024 * 1024;

describe("controlled socket interruption resume (two loopback WebDAV targets)", () => {
  it("cuts sockets mid-body, makes no HTTP during backoff, and counts hard cuts", async () => {
    const endpointA = await startDav();
    const endpointB = await startDav();
    const a = await fixture(INCOMPRESSIBLE_BYTES);
    roots.push(a.root);
    const sourceHashBefore = await hashFile(a.path);
    const proxy = await startFaultProxy(endpointA);

    const victim = dav({ endpoint: proxy.endpoint, prefix: "synthetic/victim", workRoot: path.join(a.root, "victim-work") });
    const healthy = healthyDav(endpointB, path.join(a.root, "healthy-work"));
    const directA = dav({ endpoint: endpointA, prefix: "synthetic/victim", workRoot: path.join(a.root, "victim-direct") });
    const queueDir = path.join(a.root, "queue");

    const t0 = 1000;
    const queue = new ReplicationQueue(queueDir, [victim, healthy], queueOpts);
    await queue.enqueue(a.archive, a.path);
    const first = await queue.pump(t0);

    expect(first.map((r) => r.status)).toEqual(["failed", "verified"]);
    expect(proxy.counters.socketCuts).toBeGreaterThanOrEqual(1);
    expect(proxy.counters.uploadRequests).toBeGreaterThanOrEqual(1);
    expect(first[0]?.attempts).toBe(1);
    expect(first[1]?.attempts).toBe(1);
    expect(first[0]?.nextAttemptAt).toBeGreaterThan(t0);
    expect(first[0]?.errorCode).toBe("TRANSFER_FAILED");
    expect(JSON.stringify(first)).not.toContain(SECRET);
    expect(await hashFile(a.path)).toEqual(sourceHashBefore);

    const cutsBefore = proxy.counters.socketCuts;
    const reqsBefore = proxy.counters.proxyRequests;
    const uploadsBefore = proxy.counters.uploadRequests;
    const sameQueue = new ReplicationQueue(queueDir, [victim, healthy], queueOpts);
    expect((await sameQueue.pump(t0)).map((r) => r.status)).toEqual(["failed", "verified"]);
    expect((await sameQueue.snapshot())[0]?.attempts).toBe(1);
    expect(proxy.counters.socketCuts).toBe(cutsBefore);
    expect(proxy.counters.proxyRequests).toBe(reqsBefore);
    expect(proxy.counters.uploadRequests).toBe(uploadsBefore);

    expect(endpointA).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxy.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(servers.length).toBeGreaterThanOrEqual(3);
    expect(servers.every((s) => s.listening)).toBe(true);
    expect((await directA.list()).some((r) => r.backupId === a.archive.backupId)).toBe(false);
    expect((await healthy.list()).find((r) => r.backupId === a.archive.backupId)?.sha256).toBe(a.archive.sha256);
  });

  it("resumes the same original proxy endpoint after recovery and restores the same SHA", async () => {
    const endpointA = await startDav();
    const endpointB = await startDav();
    const a = await fixture(INCOMPRESSIBLE_BYTES);
    roots.push(a.root);
    const before: ArchiveRef = structuredClone(a.archive);
    const sourceHashBefore = await hashFile(a.path);
    const proxy = await startFaultProxy(endpointA);

    const victim = dav({ endpoint: proxy.endpoint, prefix: "synthetic/victim", workRoot: path.join(a.root, "victim-work") });
    const healthy = healthyDav(endpointB, path.join(a.root, "healthy-work"));
    const directA = dav({ endpoint: endpointA, prefix: "synthetic/victim", workRoot: path.join(a.root, "victim-direct") });
    const queueDir = path.join(a.root, "queue");

    const t0 = 1000;
    await new ReplicationQueue(queueDir, [victim, healthy], queueOpts).enqueue(a.archive, a.path);
    const first = await new ReplicationQueue(queueDir, [victim, healthy], queueOpts).pump(t0);
    expect(first.map((r) => r.status)).toEqual(["failed", "verified"]);
    expect(proxy.counters.socketCuts).toBeGreaterThanOrEqual(1);

    expect(endpointA).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxy.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(servers.length).toBeGreaterThanOrEqual(3);
    expect(servers.every((s) => s.listening)).toBe(true);
    expect((await directA.list()).some((r) => r.backupId === a.archive.backupId)).toBe(false);
    expect((await healthy.list()).find((r) => r.backupId === a.archive.backupId)?.sha256).toBe(before.sha256);
    await assertArchive(a.path, before);
    expect(await hashFile(a.path)).toEqual(sourceHashBefore);
    await restoredFromId(healthy, a.archive.backupId, sourceHashBefore, a.root, "healthy-unaffected", a);

    proxy.state.disrupted = false;
    const resumed = new ReplicationQueue(queueDir, [victim, healthy], queueOpts);
    const final = await resumed.pump(t0 + 1000);
    expect(final.map((r) => r.status)).toEqual(["verified", "verified"]);
    expect(final[0]?.attempts).toBe(2);
    expect(final[1]?.attempts).toBe(1);
    expect(final[0]?.archive.sha256).toBe(before.sha256);
    expect(JSON.stringify(final)).not.toContain(SECRET);
    expect(await hashFile(a.path)).toEqual(sourceHashBefore);

    await victim.verify(a.archive);
    await restoredFromId(victim, a.archive.backupId, sourceHashBefore, a.root, "victim-resumed", a);
    await restoredFromId(healthy, a.archive.backupId, sourceHashBefore, a.root, "healthy-final", a);
  });
});
