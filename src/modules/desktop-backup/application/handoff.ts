import { copyFile } from "node:fs/promises";
import path from "node:path";
import { compareState, type TransferState } from "../domain/handoff";
import { BackupError, archiveRefSchema, type ArchiveRef, type BackupManifest } from "../domain/contracts";
import { atomicJson, protectedDir } from "../infrastructure/fs";
import { assertArchive } from "../infrastructure/transfer";
import { validateManifest } from "../infrastructure/archive";
export interface TransferArchive { path: string; archive: ArchiveRef; manifest: BackupManifest }
export interface HandoffCoordinator {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  loadState(): Promise<TransferState>;
  saveState(state: TransferState): Promise<void>;
  createVerified(): Promise<TransferArchive>;
  applyVerified(archive: TransferArchive): Promise<void>;
  /** Decrypt, verify hashes/SQLite and return actual embedded manifest. */
  verifyIncoming(archive: TransferArchive): Promise<BackupManifest>;
}
export class StateTransfer {
  constructor(private readonly coordinator: HandoffCoordinator, private readonly conflictsRoot: string) {}
  async give() {
    return this.coordinator.exclusive(async () => {
      const archive = await this.coordinator.createVerified(); await assertArchive(archive.path, archive.archive);
      const m = archive.manifest;
      await this.coordinator.saveState({ deploymentId: m.deploymentId, instanceId: m.instanceId, deviceId: m.deviceId, snapshotRevision: m.snapshotRevision, parentBackupId: m.parentBackupId, backupId: m.backupId, manifestSha256: m.manifestSha256, dirtySinceBackup: false, readOnly: true });
      return archive;
    });
  }
  async compare(incoming: BackupManifest) { return compareState(await this.coordinator.loadState(), incoming); }
  /** Validation is mandatory, even for USB or a previously uploaded archive. */
  async receive(incoming: TransferArchive, manualManagerConfirmation = false) {
    return this.coordinator.exclusive(async () => {
      await assertArchive(incoming.path, incoming.archive); archiveRefSchema.parse(incoming.archive);
      const actual = validateManifest(await this.coordinator.verifyIncoming(incoming));
      if (actual.backupId !== incoming.archive.backupId || actual.manifestSha256 !== incoming.manifest.manifestSha256) throw new BackupError("TRANSFER_MANIFEST_MISMATCH");
      incoming = { ...incoming, manifest: actual };
      const local = await this.coordinator.loadState(); const comparison = compareState(local, incoming.manifest);
      if (comparison === "same" || comparison === "local_changed") return { status: comparison };
      if (comparison === "conflict") {
        const own = await this.coordinator.createVerified();
        await this.preserve(own); await this.preserve(incoming);
        if (!manualManagerConfirmation) return { status: "conflict" as const };
      }
      await this.coordinator.applyVerified(incoming);
      const m = incoming.manifest;
      // Preserve local device identity; a received snapshot does not clone the source installation.
      await this.coordinator.saveState({ ...local, deploymentId: m.deploymentId, snapshotRevision: m.snapshotRevision, parentBackupId: m.parentBackupId, backupId: m.backupId, manifestSha256: m.manifestSha256, dirtySinceBackup: false, readOnly: false });
      return { status: "received" as const };
    });
  }
  private async preserve(item: TransferArchive) {
    await assertArchive(item.path, item.archive); await protectedDir(this.conflictsRoot);
    archiveRefSchema.parse(item.archive);
    const file = path.join(this.conflictsRoot, item.archive.backupId + "-" + item.archive.sha256 + ".crmbackup");
    const { constants } = await import("node:fs");
    try { await copyFile(item.path, file, constants.COPYFILE_EXCL); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; await assertArchive(file, item.archive); }
    await atomicJson(file + ".json", { archive: item.archive, manifestSha256: item.manifest.manifestSha256 });
  }
}
