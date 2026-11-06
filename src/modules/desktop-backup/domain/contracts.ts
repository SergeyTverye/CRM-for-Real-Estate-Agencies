import { z } from "zod";
export interface SnapshotSource { createConsistentSnapshot(destPath: string): Promise<void> }
/** Excludes DB writes and awaits in-flight storage writes throughout work. */
export interface SnapshotBarrier { run<T>(work: () => Promise<T>): Promise<T> }
export interface SnapshotValidator { validate(path: string): Promise<void> }
export const identitySchema = z.object({
  deploymentId: z.uuid(), instanceId: z.uuid(), deviceId: z.uuid(),
  snapshotRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), parentBackupId: z.uuid().nullable(),
}).strict();
export type SnapshotIdentity = z.infer<typeof identitySchema>;
export const encryptionSchema = z.object({
  alg: z.literal("AES-256-GCM-chunked"), kdf: z.literal("scrypt"),
  params: z.object({ N: z.literal(32768), r: z.literal(8), p: z.literal(1), salt: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
}).strict();
export const manifestSchema = identitySchema.extend({
  backupId: z.uuid(), formatVersion: z.literal(1), crmVersion: z.string().min(1).max(80),
  schemaVersion: z.number().int().nonnegative(), createdAtUtc: z.iso.datetime(),
  components: z.array(z.enum(["sqlite", "documents", "photos", "templates", "settings"])),
  files: z.array(z.object({ path: z.string().min(1).max(1024), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(2).max(100000),
  encryption: encryptionSchema, kind: z.literal("full"),
  verification: z.object({ files: z.literal("sha256"), snapshot: z.literal("integrity-and-foreign-keys"), verifiedAtUtc: z.iso.datetime() }).strict(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type BackupManifest = z.infer<typeof manifestSchema>;
export type BackupMetadata = SnapshotIdentity & { crmVersion: string; schemaVersion: number };
export interface ArchiveRef { backupId: string; size: number; sha256: string; createdAtUtc: string }
export interface BackupDestination {
  readonly id: string;
  put(archive: ArchiveRef, sourcePath: string, signal?: AbortSignal): Promise<void>;
  list(): Promise<ArchiveRef[]>;
  get(backupId: string, destPath: string, signal?: AbortSignal): Promise<void>;
  delete(backupId: string): Promise<void>;
  verify(archive: ArchiveRef, signal?: AbortSignal): Promise<void>;
}
export const archiveRefSchema = z.object({ backupId: z.uuid(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAtUtc: z.iso.datetime() }).strict();
export const safeSettingsSchema = z.object({
  timeZone: z.string().max(80).optional(), locale: z.enum(["ru-RU", "en-US"]).optional(),
  backupSchedule: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict().optional(),
}).strict();
export type SafeSettings = z.infer<typeof safeSettingsSchema>;
export class BackupError extends Error { constructor(readonly code: string) { super(code); this.name = "BackupError"; } }
export function assertBackupId(id: string) { return z.uuid().parse(id); }
export const DEFAULT_LIMITS = { archiveBytes: 100 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, fileBytes: 20 * 1024 ** 3, files: 100000, manifestBytes: 16 * 1024 ** 2 };
export type ArchiveLimits = typeof DEFAULT_LIMITS;
