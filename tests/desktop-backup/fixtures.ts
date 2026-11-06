import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { SqliteSnapshotValidator } from "../../src/modules/desktop-backup/infrastructure/sqlite-validator";
export const validator = new SqliteSnapshotValidator();
export const barrier = { run: <T>(fn: () => Promise<T>) => fn() };
export const passphrase = "synthetic passphrase only";
export async function fixture(bytes = 0) {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-backup-test-"));
  const database = path.join(root, "source.sqlite"); const db = new Database(database);
  db.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT); INSERT INTO sample VALUES ('synthetic-id','synthetic-record')");
  db.close(); const documents = path.join(root, "documents"); await mkdir(documents);
  await writeFile(path.join(documents, "sample.txt"), "synthetic document");
  if (bytes) await writeFile(path.join(documents, "synthetic.bin"), randomBytes(bytes));
  const recoveryKey = newRecoveryKey();
  const input = { outputDir: path.join(root, "archives"), stagingRoot: path.join(root, "staging"), source: { async createConsistentSnapshot(dest: string) { const sqlite = new Database(database); try { await sqlite.backup(dest); } finally { sqlite.close(); } } }, barrier, validator, metadata: { crmVersion: "3.2.1", schemaVersion: 1, deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null }, passphrase, recoveryKey, recoveryKeySaved: true as const, settings: { timeZone: "Asia/Novosibirsk" }, storage: { documents } };
  const archive = await createArchive(input);
  return { root, database, documents, input, recoveryKey, ...archive };
}
