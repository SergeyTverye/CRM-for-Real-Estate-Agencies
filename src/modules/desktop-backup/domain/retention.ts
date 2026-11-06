import { BackupError, type ArchiveRef } from "./contracts";
export interface RetainedBackup extends ArchiveRef { recoverable: boolean }
export interface RetentionPolicy { keep: number; maxAgeDays: number; maxBytes: number; minRecoverable?: number }
export function planRetention(backups: RetainedBackup[], policy: RetentionPolicy, now = Date.now()) {
  if (policy.keep < 1 || policy.maxBytes < 0 || policy.maxAgeDays < 0) throw new BackupError("RETENTION_POLICY");
  const sorted = [...backups].sort((a, b) => Date.parse(b.createdAtUtc) - Date.parse(a.createdAtUtc));
  const protectedIds = new Set(sorted.filter(b => b.recoverable).slice(0, Math.max(1, policy.minRecoverable ?? 2)).map(b => b.backupId));
  const remove = new Set<string>(); let retained = sorted.length; let bytes = sorted.reduce((n, b) => n + b.size, 0);
  for (const item of [...sorted].reverse()) {
    if (protectedIds.has(item.backupId)) continue;
    if (retained > policy.keep || bytes > policy.maxBytes || now - Date.parse(item.createdAtUtc) > policy.maxAgeDays * 86400000) { remove.add(item.backupId); retained--; bytes -= item.size; }
  }
  return { deleteIds: [...remove], retainedBytes: bytes, spaceLimitExceeded: bytes > policy.maxBytes };
}
