import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { hashFile } from "@/modules/desktop-backup/infrastructure/fs";
import { cleanupNativeImports, importNativeArchive, nativeArchiveUsage, nativeIncomingRoot, withNativeArchiveBudget } from "@/modules/desktop-backup/application/native-dialog";
import { backupControlCommand } from "@/modules/desktop-backup/application/backup-control";
import type { Actor } from "@/modules/auth/domain/actor";

const fake = vi.hoisted(() => ({ maxBytes: 100, backupId: "", dispose: vi.fn(), extract: vi.fn() }));
const queue = vi.hoisted(() => ({ create: vi.fn(), put: vi.fn() }));
vi.mock("@/shared/db/client", () => ({ db: { backupQueueJournal: { create: queue.create } } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
vi.mock("@/modules/desktop-backup/infrastructure/settings-repository", () => ({ JsonSettingsRepository: class { async read() { return { retention: { maxBytes: fake.maxBytes } }; } } }));
vi.mock("@/modules/desktop-backup/infrastructure/archive", () => ({ extractArchive: fake.extract }));
vi.mock("@/modules/desktop-backup/infrastructure/sqlite-validator", () => ({ SqliteSnapshotValidator: class {} }));
vi.mock("@/modules/desktop-backup/infrastructure/destinations-runtime", () => ({ backupRuntimeRoot: () => process.env.BACKUP_SETTINGS_DIR!, runtimeCredentialStore: () => ({ put: queue.put }) }));
let temp: string, output: string;
const actor = "synthetic-manager";
beforeEach(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "native-budget-"));
  output = path.join(temp, "archives"); await mkdir(output);
  vi.stubEnv("BACKUP_SETTINGS_DIR", path.join(temp, "runtime"));
  fake.maxBytes = 100; fake.backupId = randomUUID(); fake.dispose.mockReset(); fake.extract.mockReset();
  queue.create.mockReset(); queue.put.mockReset();
  fake.extract.mockImplementation(async () => ({ manifest: { backupId: fake.backupId, components: ["sqlite"], createdAtUtc: new Date().toISOString() }, dispose: fake.dispose }));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true }); });
async function staged() {
  const id = randomUUID(), dir = path.join(nativeIncomingRoot(), id); await mkdir(dir, { recursive: true });
  const file = path.join(dir, "archive.crmbackup"); await writeFile(file, "synthetic!");
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify({ actorUserId: actor, expiresAt: Date.now() + 60000, ...await hashFile(file) }));
  return id;
}
const run = (id: string) => importNativeArchive(id, actor, { passphrase: "synthetic-only" }, output);
describe("bounded native archive publication (synthetic files only)", () => {
  const commands = () => path.join(temp, "runtime", "commands");
  const reap = (id?: string) => withNativeArchiveBudget(output, () => cleanupNativeImports(output, commands(), id));
  async function publishCommand(backupId: string) {
    await mkdir(commands(), { recursive: true });
    const file = path.join(commands(), randomUUID() + ".json");
    await writeFile(file, JSON.stringify({ command: { action: "restore", backupId } })); return file;
  }
  it("HTTP application boundary cleans a from-file import when journal publication fails", async () => {
    vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop"); vi.stubEnv("CRM_DESKTOP_SUPERVISED_UPGRADE", "1");
    vi.stubEnv("BACKUP_PATH", path.join(temp, "public-backups"));
    queue.create.mockRejectedValueOnce(Error("synthetic queue failure"));
    await expect(backupControlCommand({ userId: actor, role: "manager" } as Actor, { action: "restore-from-file", requestId: await staged(), confirmed: true, passphrase: "synthetic-only-passphrase" })).rejects.toThrow();
    expect(await readdir(path.join(temp, "public-backups", "portable"))).toEqual([]);
    expect(queue.create).toHaveBeenCalledOnce();
  });
  it("HTTP publication holds the shared lock and keeps the exact command input until completion", async () => {
    vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop"); vi.stubEnv("CRM_DESKTOP_SUPERVISED_UPGRADE", "1");
    vi.stubEnv("BACKUP_PATH", path.join(temp, "public-backups"));
    const root = path.join(temp, "public-backups", "portable");
    queue.create.mockImplementationOnce(async () => {
      await expect(withNativeArchiveBudget(root, async () => undefined)).rejects.toThrow();
    });
    const response = await backupControlCommand({ userId: actor, role: "manager" } as Actor, { action: "restore-from-file", requestId: await staged(), confirmed: true, passphrase: "synthetic-only-passphrase" }) as { requestId: string };
    const request = JSON.parse(await readFile(path.join(commands(), response.requestId + ".json"), "utf8"));
    expect(request.command).toEqual({ action: "restore", backupId: fake.backupId, confirmed: true });
    await withNativeArchiveBudget(root, () => cleanupNativeImports(root, commands()));
    expect((await nativeArchiveUsage(root)).imports).toBe(1);
  });
  it("supports more than four completed imports and repeated selection of the same UUID", async () => {
    for (let i = 0; i < 7; i++) {
      let request = "";
      await importNativeArchive(await staged(), actor, { passphrase: "synthetic-only" }, output, async id => { request = await publishCommand(id); });
      await reap(); expect(await readFile(path.join(output, fake.backupId + ".crmbackup"), "utf8")).toBe("synthetic!");
      await withNativeArchiveBudget(output, async () => {
        await writeFile(request.replace(".json", ".result.json"), JSON.stringify({ status: "restored" }));
        await rm(request); await cleanupNativeImports(output, commands(), fake.backupId);
      });
      expect((await nativeArchiveUsage(output)).imports).toBe(0);
    }
  });
  it("automatically removes an exact import on queue-publication failure", async () => {
    await expect(importNativeArchive(await staged(), actor, { passphrase: "synthetic-only" }, output, async () => { throw Error("queue failed"); })).rejects.toThrow("queue failed");
    expect(await readdir(output)).toEqual([]);
  });
  it("preserves queued/running and second references until the final command is removed", async () => {
    await run(await staged()); const first = await publishCommand(fake.backupId), second = await publishCommand(fake.backupId);
    await reap(); await rm(first); await reap();
    expect((await nativeArchiveUsage(output)).imports).toBe(1);
    await rm(second); await reap(); expect(await readdir(output)).toEqual([]);
  });
  it("keeps input if publication throws after a command has become visible", async () => {
    await expect(importNativeArchive(await staged(), actor, { passphrase: "synthetic-only" }, output, async id => { await publishCommand(id); throw Error("late queue failure"); })).rejects.toThrow();
    expect((await nativeArchiveUsage(output)).imports).toBe(1);
  });
  it("reaps validated idle crash orphans before the next import without deleting ordinary catalog", async () => {
    await run(await staged()); const catalogId = fake.backupId;
    const catalogFile = path.join(output, catalogId + ".crmbackup"); await writeFile(catalogFile + ".json", "catalog marker");
    fake.backupId = randomUUID(); await run(await staged());
    const idle = fake.backupId; fake.backupId = randomUUID();
    await importNativeArchive(await staged(), actor, { passphrase: "synthetic-only" }, output, async id => { await publishCommand(id); });
    await expect(readFile(path.join(output, idle + ".crmbackup"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(catalogFile, "utf8")).toBe("synthetic!");
    expect(await readFile(catalogFile + ".json", "utf8")).toBe("catalog marker");
  });
  it.each(["hash", "id", "malformed"])("retains a tampered %s reference with diagnostic", async kind => {
    await run(await staged()); const file = path.join(output, fake.backupId + ".crmbackup"), ref = file + ".import.json";
    if (kind === "hash") await writeFile(file, "changed");
    else if (kind === "id") { const value = JSON.parse(await readFile(ref, "utf8")); value.archive.backupId = randomUUID(); await writeFile(ref, JSON.stringify(value)); }
    else await writeFile(ref, "{}");
    await expect(reap()).rejects.toThrow("IMPORT_CACHE_RETAINED_INVALID");
    expect(await readFile(file, "utf8")).toBe(kind === "hash" ? "changed" : "synthetic!");
    expect(await readFile(ref, "utf8")).toBeTruthy();
  });
  it("fails closed on ambiguous command metadata and rejects arbitrary cleanup IDs", async () => {
    await run(await staged()); await mkdir(commands(), { recursive: true });
    await writeFile(path.join(commands(), randomUUID() + ".json"), "{}");
    await expect(reap()).rejects.toThrow("IMPORT_COMMANDS_AMBIGUOUS");
    await expect(reap("../outside")).rejects.toThrow("IMPORT_ID_INVALID");
    expect((await nativeArchiveUsage(output)).imports).toBe(1);
  });
  it("never follows sidecar storage paths or removes selected originals/unrelated archives", async () => {
    const original = path.join(temp, "original.crmbackup"); await writeFile(original, "original synthetic source");
    const unrelated = path.join(output, randomUUID() + ".crmbackup"); await writeFile(unrelated, "ordinary unknown archive");
    await run(await staged()); const ref = path.join(output, fake.backupId + ".crmbackup.import.json");
    const metadata = JSON.parse(await readFile(ref, "utf8"));
    metadata.path = original; await writeFile(ref, JSON.stringify(metadata));
    await expect(reap()).rejects.toThrow("IMPORT_CACHE_RETAINED_INVALID");
    expect(await readFile(original, "utf8")).toBe("original synthetic source");
    expect(await readFile(unrelated, "utf8")).toBe("ordinary unknown archive");
  });
  it("does not traverse a junction while cleaning validated cache candidates", async () => {
    await run(await staged()); const junction = path.join(temp, "cleanup-junction");
    await symlink(output, junction, "junction");
    await expect(cleanupNativeImports(junction, commands())).rejects.toThrow("SYMLINK_FORBIDDEN");
    expect((await nativeArchiveUsage(output)).imports).toBe(1);
  });
  const lockPath = () => path.join(output, ".native-budget.lock");
  const deadPid = 2147483646;
  async function deadLock() {
    const owner = { pid: deadPid, token: randomUUID(), createdAt: "2000-01-01T00:00:00.000Z" };
    await writeFile(lockPath(), JSON.stringify(owner)); return owner;
  }
  function mockDeath(code = "ESRCH") {
    return vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(signal).toBe(0);
      if (pid === deadPid) throw Object.assign(Error("synthetic process probe"), { code });
      return true;
    });
  }
  it("publishes complete owner metadata and refuses a live/reused PID regardless of age", async () => {
    const owner = await deadLock(); const probe = vi.spyOn(process, "kill").mockReturnValue(true);
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(lockPath(), "utf8"))).toEqual(owner);
    expect(probe).toHaveBeenCalledWith(deadPid, 0);
  });
  it("reclaims a proven dead owner and publishes a fresh pid/nonce before work", async () => {
    const old = await deadLock(); mockDeath();
    await withNativeArchiveBudget(output, async () => {
      const owner = JSON.parse(await readFile(lockPath(), "utf8"));
      expect(owner.pid).toBe(process.pid); expect(owner.token).not.toBe(old.token);
      expect(Number.isFinite(Date.parse(owner.createdAt))).toBe(true);
    });
    expect(await readdir(output)).toEqual([]);
  });
  it("recovers an actual exited child owner's lock without a mocked process probe", async () => {
    const child = spawn(process.execPath, ["-e", 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,token:process.argv[2],createdAt:new Date().toISOString()}),{flag:"wx"})', lockPath(), randomUUID()], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(Error("synthetic child failed")));
    });
    let ran = false;
    await withNativeArchiveBudget(output, async () => { ran = true; });
    expect(ran).toBe(true); expect(await readdir(output)).toEqual([]);
  });
  it("recovers a recovery guard left by a dead process as well", async () => {
    const owner = await deadLock(); mockDeath();
    await writeFile(lockPath() + ".retire-" + owner.token, JSON.stringify({ ...owner, token: randomUUID() }));
    await withNativeArchiveBudget(output, async () => undefined);
    expect(await readdir(output)).toEqual([]);
  });
  it.each(["EPERM", "EACCES", "UNKNOWN"])("never steals on %s", async code => {
    const owner = await deadLock(); mockDeath(code);
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(lockPath(), "utf8"))).toEqual(owner);
  });
  it.each(["", "{}", "not-json", '{"pid":-1}', '{"pid":1,"token":"bad","createdAt":"old"}'])("fails closed for malformed metadata %s", async content => {
    await writeFile(lockPath(), content); const probe = vi.spyOn(process, "kill");
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
    expect(await readFile(lockPath(), "utf8")).toBe(content); expect(probe).not.toHaveBeenCalled();
  });
  it("allows only one concurrent recovery claimant into work", async () => {
    await deadLock(); mockDeath();
    let entered = 0;
    let unlock!: () => void;
    const held = new Promise<void>(resolve => { unlock = resolve; });
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const claim = () => withNativeArchiveBudget(output, async () => { entered++; started(); await held; });
    const first = claim(); const second = claim();
    const outcomes = [first, second].map(p => p.then(() => "won", () => "denied"));
    await ready;
    expect(await Promise.race(outcomes)).toBe("denied");
    await expect(withNativeArchiveBudget(output, async () => { entered++; })).rejects.toThrow();
    unlock();
    expect((await Promise.all(outcomes)).sort()).toEqual(["denied", "won"]);
    expect(entered).toBe(1);
  });
  it("preserves the current lock if the PID becomes live before retirement", async () => {
    await deadLock(); let probes = 0;
    vi.spyOn(process, "kill").mockImplementation(pid => {
      if (pid === deadPid && ++probes === 1) throw Object.assign(Error("dead"), { code: "ESRCH" });
      return true;
    });
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
    expect(await readFile(lockPath(), "utf8")).toContain(String(deadPid));
  });
  it("rechecks the nonce before retirement and leaves a newly published owner intact", async () => {
    await deadLock();
    const successor = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    vi.spyOn(process, "kill").mockImplementation(pid => {
      if (pid === deadPid) {
        writeFileSync(lockPath(), JSON.stringify(successor));
        throw Object.assign(Error("dead"), { code: "ESRCH" });
      }
      return true;
    });
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(lockPath(), "utf8"))).toEqual(successor);
  });
  it("cleanup checks nonce and inode and preserves a replacement current lock", async () => {
    const successor = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    await withNativeArchiveBudget(output, async () => {
      await rename(lockPath(), lockPath() + ".original");
      await writeFile(lockPath(), JSON.stringify(successor), { flag: "wx" });
    });
    expect(JSON.parse(await readFile(lockPath(), "utf8"))).toEqual(successor);
    await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toThrow();
  });
  it("does not release an in-place lock with another nonce", async () => {
    const successor = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    await withNativeArchiveBudget(output, async () => { await writeFile(lockPath(), JSON.stringify(successor)); });
    expect(JSON.parse(await readFile(lockPath(), "utf8"))).toEqual(successor);
  });
  it("caps successful imports before extraction, including repeated queue-failure leftovers", async () => {
    for (let i = 0; i < 4; i++) { fake.backupId = randomUUID(); await run(await staged()); }
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).toHaveBeenCalledTimes(4);
    expect((await nativeArchiveUsage(output)).imports).toBe(4);
    expect(await readdir(nativeIncomingRoot())).toEqual([]);
  });
  it("counts ordinary archives and aggregate native/ordinary pending bytes", async () => {
    await writeFile(path.join(output, "ordinary.crmbackup"), Buffer.alloc(40));
    await writeFile(path.join(output, "one.native.pending"), Buffer.alloc(30));
    await writeFile(path.join(output, "two.crmbackup.pending"), Buffer.alloc(21));
    expect(await nativeArchiveUsage(output)).toEqual({ bytes: 91, pendingBytes: 51, imports: 1 });
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).not.toHaveBeenCalled();
  });
  it("counts abandoned native pending reservations toward the four-import cap", async () => {
    for (let i = 0; i < 4; i++) await writeFile(path.join(output, randomUUID() + ".native.pending"), "x");
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).not.toHaveBeenCalled();
    expect(await readdir(output)).toHaveLength(4);
  });
  it.each([".crmbackup", ".crmbackup.import.json", ".crmbackup.json"])("never replaces an existing %s or removes an unowned input", async suffix => {
    const file = path.join(output, fake.backupId + suffix); await writeFile(file, "keep");
    await expect(run(await staged())).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("keep");
    expect((await readdir(output)).filter(n => n.endsWith(".pending"))).toEqual([]);
  });
  it("leaves imported input out of ordinary retention and holds it through protective work", async () => {
    await run(await staged()); const file = path.join(output, fake.backupId + ".crmbackup");
    await withNativeArchiveBudget(output, async () => {
      expect(await readFile(file, "utf8")).toBe("synthetic!");
      await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(file + ".import.json", "utf8")).toContain(fake.backupId);
    });
    await expect(readFile(file + ".json")).rejects.toMatchObject({ code: "ENOENT" });
    expect(fake.dispose).toHaveBeenCalledOnce();
  });
  it("preserves published restore input after failed protective work and releases only its lock", async () => {
    await run(await staged()); const file = path.join(output, fake.backupId + ".crmbackup");
    await expect(withNativeArchiveBudget(output, async () => { throw Error("synthetic protective failure"); })).rejects.toThrow("synthetic protective failure");
    expect(await readFile(file, "utf8")).toBe("synthetic!");
    expect(await readFile(file + ".import.json", "utf8")).toContain(fake.backupId);
    await withNativeArchiveBudget(output, async () => undefined);
  });
  it("cleans validation work and lock on failure without publishing", async () => {
    fake.extract.mockResolvedValueOnce({ manifest: { components: ["postgres"] }, dispose: fake.dispose });
    await expect(run(await staged())).rejects.toThrow("SQLITE_RESTORE_REQUIRED");
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(await readdir(output)).toEqual([]);
    expect(await readdir(nativeIncomingRoot())).toEqual([]);
  });
  it("does not unlink an unowned pending file on collision", async () => {
    const id = await staged(), pending = path.join(output, id + ".native.pending");
    await writeFile(pending, "keep");
    await expect(run(id)).rejects.toThrow("ARCHIVE_ID_COLLISION");
    expect(await readFile(pending, "utf8")).toBe("keep");
  });
  it("rejects directories and junctions in counted storage paths", async () => {
    const dir = path.join(output, "invalid.crmbackup"); await mkdir(dir);
    await expect(run(await staged())).rejects.toThrow("REGULAR_FILE_REQUIRED");
    await rm(dir, { recursive: true });
    const junction = path.join(temp, "junction"); await symlink(output, junction, "junction");
    await expect(withNativeArchiveBudget(junction, async () => undefined)).rejects.toThrow("SYMLINK_FORBIDDEN");
  });
});
