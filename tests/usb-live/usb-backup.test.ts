import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { parseUsbSmokeArgs } from "../../scripts/acceptance/usb-backup-live";
import { createArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { LocalDir } from "../../src/modules/desktop-backup/infrastructure/local-destination";
import { newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { SqliteSnapshotValidator } from "../../src/modules/desktop-backup/infrastructure/sqlite-validator";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import type { BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const parent = await realpath(path.dirname(root));
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory() || path.dirname(await realpath(root)) !== parent) throw new Error("TEST_OWN_ROOT_INVALID");
    await rm(root, { recursive: true, force: false });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-usb-unit-")); roots.push(root);
  const dbPath = path.join(root, "db.sqlite"); const db = new Database(dbPath);
  try { db.exec("CREATE TABLE synthetic_control(id TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO synthetic_control VALUES ('id','ok')"); } finally { db.close(); }
  const docs = path.join(root, "documents"); await mkdir(docs); await writeFile(path.join(docs, "control.bin"), Buffer.alloc(4096, 19));
  const passphrase = "synthetic-test-passphrase"; const validator = new SqliteSnapshotValidator();
  const archive = await createArchive({
    outputDir: path.join(root, "archives"), stagingRoot: path.join(root, "staging"),
    source: { async createConsistentSnapshot(target) { const source = new Database(dbPath); try { await source.backup(target); } finally { source.close(); } } },
    barrier: { run: work => work() }, validator,
    metadata: { crmVersion: "synthetic-test", schemaVersion: 1, deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null },
    passphrase, recoveryKey: newRecoveryKey(), recoveryKeySaved: true, settings: { locale: "ru-RU" }, storage: { documents: docs },
  });
  return { root, archive, passphrase, validator };
}

describe("USB backup safety and synthetic transfer proof", () => {
  it("requires explicit opt-in and a drive argument", async () => {
    expect(parseUsbSmokeArgs([])).toBeNull();
    expect(() => parseUsbSmokeArgs(["--execute-usb-smoke"])).toThrow("DRIVE_ARGUMENT_INVALID");
    expect(() => parseUsbSmokeArgs(["--execute-usb-smoke", "--drive", "E:\\"])).toThrow("DRIVE_ARGUMENT_INVALID");
    expect(parseUsbSmokeArgs(["--execute-usb-smoke", "--drive", "E:"])).toBe("E:");
  });

  it("runs CLI without opt-in, emits only fixed code, and never probes a drive", () => {
    const child = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/acceptance/usb-backup-live.ts"], { encoding: "utf8", timeout: 15_000 });
    expect(child.status).toBe(2);
    expect(child.stdout.trim()).toBe('{"code":"USB_SMOKE_OPT_IN_REQUIRED"}');
    expect(child.stderr).toBe("");
  });

  it("writes and reads a verified archive on an isolated local directory", async () => {
    const f = await fixture(); const destinationRoot = path.join(f.root, "destination");
    const destination = new LocalDir("synthetic-local", destinationRoot);
    await destination.put(f.archive.archive, f.archive.path);
    await destination.verify(f.archive.archive);
    const readback = path.join(f.root, "readback.crmbackup"); await destination.get(f.archive.archive.backupId, readback);
    expect((await hashFile(readback)).sha256).toBe(f.archive.archive.sha256);
  });

  it("checks failing target as injected IO and preserves source archive", async () => {
    const f = await fixture(); const sourceHash = await hashFile(f.archive.path);
    const destination: BackupDestination = {
      id: "synthetic-injected-io",
      async put() { throw new Error("INJECTED_IO_FAILURE"); }, async list() { return []; }, async get() { throw new Error("INJECTED_IO_FAILURE"); },
      async delete() {}, async verify() { throw new Error("INJECTED_IO_FAILURE"); },
    };
    await expect(destination.put(f.archive.archive, f.archive.path)).rejects.toThrow("INJECTED_IO_FAILURE");
    expect(await hashFile(f.archive.path)).toEqual(sourceHash);
  });
});
