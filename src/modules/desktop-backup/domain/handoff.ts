import type { BackupManifest, SnapshotIdentity } from "./contracts";
export interface TransferState extends SnapshotIdentity {
  backupId: string; manifestSha256: string; dirtySinceBackup: boolean; readOnly: boolean;
}
export type Comparison = "same" | "incoming" | "local_changed" | "conflict";
export function compareState(local: TransferState, incoming: BackupManifest): Comparison {
  if (local.deploymentId !== incoming.deploymentId) return "conflict";
  if (local.backupId === incoming.backupId) {
    if (local.manifestSha256 !== incoming.manifestSha256) return "conflict";
    return local.dirtySinceBackup ? "local_changed" : "same";
  }
  if (local.dirtySinceBackup) return "conflict";
  if (incoming.parentBackupId === local.backupId && incoming.snapshotRevision > local.snapshotRevision) return "incoming";
  return "conflict";
}
