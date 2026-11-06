import Database from "better-sqlite3";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { disconnectDb } from "@/shared/db/client";
import { sqliteFilePath } from "@/shared/db/sqlite-adapter";
import { BackupError, type BackupManifest } from "../domain/contracts";
import type { TransferState } from "../domain/handoff";
import { createArchive, extractArchive, type Credential } from "../infrastructure/archive";
import { SqliteSnapshotValidator } from "../infrastructure/sqlite-validator";
import { atomicJson } from "../infrastructure/fs";
import { runtimeCredentialStore, backupRuntimeRoot, withBackupDestinations } from "../infrastructure/destinations-runtime";
import { DatabaseReplicationJournal } from "../infrastructure/database-journal";
import { ReplicationQueue } from "./replication-queue";
import { StateTransfer, type TransferArchive } from "./handoff";
import { pruneLocalPortable } from "./local-retention";
import { GenerationStore, restoreArchive } from "./restore";
import { archiveRoot, commandRoot } from "./backup-control";
import { newRecoveryKey } from "../infrastructure/encryption";
import { JsonSettingsRepository } from "../infrastructure/settings-repository";
import { cleanupNativeImports, nativeArchiveUsage, withNativeArchiveBudget } from "./native-dialog";
const validator = new SqliteSnapshotValidator();
const root = () => process.env.DESKTOP_DATA_DIR!;
const database = () => sqliteFilePath(process.env.DATABASE_URL!);
const stateFile = () => path.join(root(), "handoff-state.json");
type LocalState = TransferState & { fingerprint: string };
/** Only called by the supervisor after every writer process has exited. */
function stopped() { if (process.env.CRM_DEPLOYMENT_MODE !== "desktop" || process.env.CRM_BACKUP_WRITERS_STOPPED !== "1") throw new BackupError("WRITERS_NOT_STOPPED"); }
export function businessFingerprint(file: string) {
  const native = new Database(file, { readonly: true }); const hash = createHash("sha256");
  try {
    const tables = native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    for (const { name } of tables) {
      if (/^(sqlite_|_prisma_|backup_|user_sessions$)/.test(name)) continue;
      hash.update(name);
      const query = native.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').safeIntegers();
      for (const row of query.iterate()) hash.update(JSON.stringify(row, (_key, value) => typeof value === "bigint" ? { integer: value.toString() } : value));
    }
    return hash.digest("hex");
  } finally { native.close(); }
}
// Only installation/configuration rows may be replaced on the first receive.
// Everything else, including unknown future tables and business audit history,
// is treated as local work even when clients/properties/deals are still absent.
const emptyWorkspaceBaselineTables = new Set([
  "users", "user_sessions", "dictionary_items", "legal_entities",
  "ai_settings", "ai_tariffs", "planner_settings", "notification_preferences",
  "backup_queue_journals", "backup_runs", "backup_remotes", "backup_target_runs",
  "_prisma_migrations",
]);
function isEmptyWorkspace(file: string): boolean {
  let native: Database.Database | null = null;
  try {
    native = new Database(file, { readonly: true, fileMustExist: true });
    return native.transaction(() => {
      const tables = native!.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      for (const { name } of tables) {
        if (name.startsWith("sqlite_") || emptyWorkspaceBaselineTables.has(name)) continue;
        const table = '"' + name.replaceAll('"', '""') + '"';
        // These exact initialization events accompany an otherwise empty setup.
        // Never ignore the whole audit table or an arbitrary setup/settings action.
        const where = name === "audit_log" ? ` WHERE NOT COALESCE(
          (action = 'desktop.setup_completed' AND entity_type = 'User' AND json_extract(after_jsonb, '$.initialData') = 'empty')
          OR (action = 'ai.tariff.seed' AND entity_type = 'AiTariff'), 0)` : "";
        if (native!.prepare("SELECT 1 FROM " + table + where + " LIMIT 1").get()) return false;
      }
      return true;
    })();
  } catch {
    // Fail closed: an unreadable or ambiguous workspace is treated as containing local business data.
    return false;
  } finally { native?.close(); }
}
async function localState(): Promise<LocalState | null> {
  try { return JSON.parse(await readFile(stateFile(), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
async function createPortable(secret: Record<string, string>) {
  stopped();
  return withNativeArchiveBudget(archiveRoot(), async () => {
  const settings = await new JsonSettingsRepository(backupRuntimeRoot()).read();
  const identity = JSON.parse(await readFile(path.join(root(), "identity.json"), "utf8"));
  const previous = await localState();
  await pruneLocalPortable(archiveRoot(), settings.retention);
  const { pendingBytes } = await nativeArchiveUsage(archiveRoot());
  if (pendingBytes >= settings.retention.maxBytes) throw new BackupError("LOCAL_BACKUP_CAPACITY");
  const result = await createArchive({
    outputDir: archiveRoot(), stagingRoot: path.join(root(), "portable-staging"), validator,
    barrier: { run: async work => { stopped(); await disconnectDb(); return work(); } },
    source: { async createConsistentSnapshot(dest) { const native = new Database(database()); try { await native.backup(dest); } finally { native.close(); } } },
    metadata: { ...identity, snapshotRevision: (previous?.snapshotRevision ?? 0) + 1, parentBackupId: previous?.backupId ?? null, crmVersion: process.env.APP_VERSION ?? "desktop", schemaVersion: 1 },
    passphrase: secret.passphrase!, recoveryKey: secret.recoveryKey!, recoveryKeySaved: true,
    settings: { timeZone: settings.schedule.timeZone, locale: "ru-RU" }, storage: { documents: process.env.FILE_STORAGE_PATH! },
    localBudget: { maxArchives: settings.retention.keep + 1, maxBytes: settings.retention.maxBytes - pendingBytes },
  });
  await atomicJson(result.path + ".json", { archive: result.archive });
  return result;
  });
}
function asCredential(secret: Record<string, string>): Credential { return secret.passphrase ? { passphrase: secret.passphrase } : { recoveryKey: secret.recoveryKey! }; }
async function saveLocalState(manifest: BackupManifest, readOnly: boolean) {
  const identity = JSON.parse(await readFile(path.join(root(), "identity.json"), "utf8"));
  const state: LocalState = { ...identity, deploymentId: manifest.deploymentId, snapshotRevision: manifest.snapshotRevision, parentBackupId: manifest.parentBackupId, backupId: manifest.backupId, manifestSha256: manifest.manifestSha256, dirtySinceBackup: false, readOnly, fingerprint: businessFingerprint(database()) };
  await atomicJson(stateFile(), state);
}
export async function executeDesktopBackupRequest(id: string) {
  stopped(); if (!/^[a-f0-9-]{36}$/.test(id)) throw new BackupError("COMMAND_ID");
  const requestFile = path.join(commandRoot(), id + ".json");
  const request = JSON.parse(await readFile(requestFile, "utf8"));
  const secret = await runtimeCredentialStore().get(request.secretRef);
  const cmd = request.command;
  let result: Record<string, unknown>;
  try {
    if (cmd.action === "create" || cmd.action === "give") {
      const created = await createPortable(secret);
      const protectedRef = randomUUID();
      await runtimeCredentialStore().put(protectedRef, secret);
      await atomicJson(path.join(root(), "portable-credential.json"), { secretRef: protectedRef });
      await saveLocalState(created.manifest, cmd.action === "give");
      await withBackupDestinations(async destinations => {
        const queue = new ReplicationQueue(path.join(root(), "backup-queue"), destinations, {}, new DatabaseReplicationJournal());
        await queue.enqueue(created.archive, created.path, cmd.destinationId ? [cmd.destinationId] : destinations.map(d => d.id));
      });
      await pruneLocalPortable(archiveRoot(), (await new JsonSettingsRepository(backupRuntimeRoot()).read()).retention);
      result = { status: "verified", archive: created.archive, readOnly: cmd.action === "give" };
    } else {
      let incomingPath = path.join(archiveRoot(), cmd.backupId + ".crmbackup");
      let cleanup = false;
      if (cmd.destinationId) {
        incomingPath = path.join(root(), "incoming-" + id + ".crmbackup");
        await withBackupDestinations(async destinations => { await destinations[0]!.get(cmd.backupId, incomingPath); }, cmd.destinationId); cleanup = true;
      }
      try {
        const checked = await extractArchive({ archivePath: incomingPath, credential: asCredential(secret), validator, schemaVersion: 1, stagingRoot: path.join(root(), "portable-staging") });
        const manifest = checked.manifest; await checked.dispose();
        if (manifest.backupId !== cmd.backupId) throw new BackupError("ARCHIVE_ID_MISMATCH");
        const own = await localState();
        const { compareState } = await import("../domain/handoff");
        const empty = !own && isEmptyWorkspace(database());
        const comparison = own ? compareState({ ...own, dirtySinceBackup: own.fingerprint !== businessFingerprint(database()) }, manifest) : empty ? "incoming" : "conflict";
        if (cmd.action === "verify") result = { status: "verified", backupId: manifest.backupId };
        else if (cmd.action === "compare") result = { status: comparison, backupId: manifest.backupId };
        else {
          if (cmd.confirmed !== true) throw new BackupError("RESTORE_CONFIRMATION_REQUIRED");
          // Receiving the known snapshot is not a rollback or a return of ownership.
          if (cmd.action === "receive" && (comparison === "same" || comparison === "local_changed")) result = { status: comparison };
          else {
          // Receive never silently overrides a divergent workspace. Ordinary restore is an explicit rollback.
          if (cmd.action === "receive" && comparison === "conflict") throw new BackupError("TRANSFER_REVISION_CONFLICT");
          const safetySecret = { passphrase: randomBytes(48).toString("base64"), recoveryKey: newRecoveryKey() };
          const safetyRef = randomUUID(); await runtimeCredentialStore().put(safetyRef, safetySecret);
          const protective = await createPortable(safetySecret);
          await atomicJson(protective.path + ".recovery.json", { secretRef: safetyRef });
          const store = new GenerationStore(path.join(root(), "runtime-generations"));
          const restored = await restoreArchive({ archivePath: incomingPath, credential: asCredential(secret), schemaVersion: 1, validator, store, confirmed: true,
            hooks: {
              async withStoppedRuntime(work) { await disconnectDb(); return work(); },
              async protectCurrent() { return { ...protective, credential: asCredential(safetySecret) }; },
              async prepareStage(stage) { const { applySqliteMigrations } = await import("../../../../scripts/desktop/database-lifecycle"); applySqliteMigrations(path.join(stage, "database.sqlite")); },
            },
          });
          // The supervisor reads this single generation pointer before starting any process.
          // Retain this installation's identity; source cloud credentials are never restored.
          process.env.DATABASE_URL = "file:" + path.join(restored.activePath, "database.sqlite");
          await saveLocalState(manifest, false);
          result = { status: "restored", backupId: manifest.backupId, protectiveBackupId: protective.archive.backupId };
          }
        }
      } finally { if (cleanup) await rm(incomingPath, { force: true }); }
    }
  } catch (e) {
    result = { status: "failed", errorCode: e instanceof BackupError ? e.code : "BACKUP_OPERATION_FAILED" };
  } finally {
    await disconnectDb(); await runtimeCredentialStore().delete(request.secretRef).catch(() => undefined);
  }
  await atomicJson(path.join(commandRoot(), id + ".result.json"), { id, action: cmd.action, createdAt: request.createdAt, finishedAt: new Date().toISOString(), ...result });
  await withNativeArchiveBudget(archiveRoot(), async () => {
    await rm(requestFile, { force: true });
    if (!cmd.destinationId && cmd.backupId) {
      try { await cleanupNativeImports(archiveRoot(), commandRoot(), cmd.backupId); }
      catch (e) { result.cleanupDiagnostic = e instanceof BackupError ? e.code : "IMPORT_CACHE_CLEANUP_FAILED"; }
    }
  });
  if (result.cleanupDiagnostic) await atomicJson(path.join(commandRoot(), id + ".result.json"), { id, action: cmd.action, createdAt: request.createdAt, finishedAt: new Date().toISOString(), ...result });
  return result;
}
export async function scheduledCredential() {
  const { secretRef } = JSON.parse(await readFile(path.join(root(), "portable-credential.json"), "utf8"));
  return runtimeCredentialStore().get(secretRef);
}
// Keep the tested generic handoff coordinator public without instantiating a second writer.
export type DesktopHandoffCoordinator = ConstructorParameters<typeof StateTransfer>[0];
export type DesktopTransferArchive = TransferArchive;

export async function createClosingBackupRequest() {
  stopped();
  const settings = await new JsonSettingsRepository(backupRuntimeRoot()).read();
  if (!settings.schedule.onClose || process.env.INSTANCE_ROLE === "standby") return;
  const secret = await scheduledCredential(); const id = randomUUID(), secretRef = randomUUID();
  await runtimeCredentialStore().put(secretRef, secret);
  const { protectedDir } = await import("../infrastructure/fs");
  const { writeFile } = await import("node:fs/promises");
  await protectedDir(commandRoot());
  await writeFile(path.join(commandRoot(), id + ".json"), JSON.stringify({ id, secretRef, command: { action: "create", recoveryKeySaved: true }, createdAt: new Date().toISOString(), trigger: "shutdown" }), { flag: "wx", mode: 0o600 });
  await executeDesktopBackupRequest(id);
}
