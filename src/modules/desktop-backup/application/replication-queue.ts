import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { archiveRefSchema, BackupError, type ArchiveRef, type BackupDestination } from "../domain/contracts";
import { atomicJson, protectedDir, regularFile } from "../infrastructure/fs";
import { assertArchive } from "../infrastructure/transfer";
import { planRetention, type RetentionPolicy, type RetainedBackup } from "../domain/retention";
const rowSchema = z.object({
  archive: archiveRefSchema, sourcePath: z.string(), destinationId: z.string().min(1).max(80),
  status: z.enum(["queued", "uploading", "uploaded", "verified", "failed"]),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.number(), errorCode: z.string().optional(),
}).strict();
export const journalSchema = z.object({ version: z.literal(1), rows: z.array(rowSchema).max(100000) }).strict();
export interface ReplicationJournal {
  read(): Promise<{ revision: number; rows: ReplicationRow[] }>;
  save(revision: number, rows: ReplicationRow[]): Promise<number>;
}
export type ReplicationRow = z.infer<typeof rowSchema>;
export interface QueueOptions { maxPendingArchives: number; maxPendingBytes: number; maxAttempts: number; baseBackoffMs: number; maxBackoffMs: number }
const defaults: QueueOptions = { maxPendingArchives: 50, maxPendingBytes: 20 * 1024 ** 3, maxAttempts: 5, baseBackoffMs: 2000, maxBackoffMs: 300000 };
/** One queue owner in desktop supervisor; all mutations serialized, crash-safe journal. */
export class ReplicationQueue {
  private rows: ReplicationRow[] = []; private loaded = false; private tail: Promise<unknown> = Promise.resolve();
  private readonly options: QueueOptions;
  private revision = 0;
  constructor(private readonly dataDir: string, private readonly destinations: BackupDestination[], options: Partial<QueueOptions> = {}, private readonly journal?: ReplicationJournal) {
    this.options = { ...defaults, ...options };
    if (new Set(destinations.map(d => d.id)).size !== destinations.length || Object.values(this.options).some(n => !Number.isFinite(n) || n <= 0)) throw new BackupError("QUEUE_CONFIGURATION");
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.tail.then(work, work); this.tail = result.catch(() => {}); return result; }
  private get file() { return path.join(this.dataDir, "backup-replication-v1.json"); }
  private async load() {
    if (this.loaded) return;
    if (this.journal) {
      const state = await this.journal.read(); this.rows = state.rows; this.revision = state.revision;
      for (const row of this.rows) if (row.status === "uploading" || row.status === "uploaded") { row.status = "queued"; row.nextAttemptAt = 0; row.attempts = Math.max(0, row.attempts - 1); }
      this.loaded = true; return;
    }
    await protectedDir(this.dataDir);
    try {
      if ((await stat(this.file)).size > 32 * 1024 ** 2) throw new BackupError("QUEUE_JOURNAL_LIMIT");
      await regularFile(this.file); this.rows = journalSchema.parse(JSON.parse(await readFile(this.file, "utf8"))).rows;
      for (const row of this.rows) if (row.status === "uploading" || row.status === "uploaded") { row.status = "queued"; row.nextAttemptAt = 0; row.attempts = Math.max(0, row.attempts - 1); }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    this.loaded = true;
  }
  private async save() {
    if (this.journal) { this.revision = await this.journal.save(this.revision, this.rows); return; }
    await atomicJson(this.file, { version: 1, rows: this.rows });
  }
  async enqueue(archive: ArchiveRef, sourcePath: string, destinationIds = this.destinations.map(d => d.id)) {
    return this.serial(async () => {
      await this.load(); archiveRefSchema.parse(archive); await assertArchive(sourcePath, archive);
      const pending = new Map(this.rows.filter(r => r.status !== "verified").map(r => [r.archive.backupId, r.archive.size]));
      if (destinationIds.some(id => !this.rows.some(r => r.archive.backupId === archive.backupId && r.destinationId === id && r.status === "verified"))) pending.set(archive.backupId, archive.size);
      if (pending.size > this.options.maxPendingArchives || [...pending.values()].reduce((n, size) => n + size, 0) > this.options.maxPendingBytes) throw new BackupError("QUEUE_CAPACITY");
      if (this.rows.some(r => r.archive.backupId === archive.backupId && r.archive.sha256 !== archive.sha256)) throw new BackupError("IMMUTABLE_CONFLICT");
      if (destinationIds.some(id => !this.destinations.some(d => d.id === id))) throw new BackupError("DESTINATION_UNKNOWN");
      if (this.rows.length + destinationIds.filter(id => !this.rows.some(r => r.archive.backupId === archive.backupId && r.destinationId === id)).length > 10000) throw new BackupError("QUEUE_HISTORY_CAPACITY");
      for (const id of destinationIds) {
        if (!this.destinations.some(d => d.id === id)) throw new BackupError("DESTINATION_UNKNOWN");
        if (!this.rows.some(r => r.archive.backupId === archive.backupId && r.destinationId === id)) this.rows.push({ archive, sourcePath, destinationId: id, status: "queued", attempts: 0, nextAttemptAt: 0 });
      }
      await this.save();
    });
  }
  async snapshot() { return this.serial(async () => { await this.load(); return structuredClone(this.rows); }); }
  /** Run on startup/network recovery/timer; does not sleep or start unbounded retry loops. */
  async pump(now = Date.now(), signal?: AbortSignal) {
    return this.serial(async () => {
      await this.load();
      for (const row of this.rows) {
        if (signal?.aborted) break;
        if (row.status === "verified" || row.nextAttemptAt > now || row.attempts >= this.options.maxAttempts) continue;
        const destination = this.destinations.find(d => d.id === row.destinationId);
        if (!destination) continue;
        row.status = "uploading"; row.attempts++; delete row.errorCode; await this.save();
        try {
          await assertArchive(row.sourcePath, row.archive); await destination.put(row.archive, row.sourcePath, signal);
          row.status = "uploaded"; await this.save();
          await destination.verify(row.archive, signal); row.status = "verified"; row.nextAttemptAt = 0;
        } catch {
          row.status = "failed"; row.errorCode = signal?.aborted ? "TRANSFER_CANCELLED" : "TRANSFER_FAILED";
          row.nextAttemptAt = now + Math.min(this.options.maxBackoffMs, this.options.baseBackoffMs * 2 ** (row.attempts - 1));
        }
        await this.save();
      }
      return structuredClone(this.rows);
    });
  }
  async retry(backupId: string, destinationId: string) {
    return this.serial(async () => { await this.load(); const row = this.rows.find(r => r.archive.backupId === backupId && r.destinationId === destinationId); if (!row || row.status !== "failed") throw new BackupError("RETRY_NOT_FAILED"); row.status = "queued"; row.attempts = 0; row.nextAttemptAt = 0; await this.save(); });
  }
  async retain(destinationId: string, catalog: RetainedBackup[], policy: RetentionPolicy) {
    return this.serial(async () => {
      await this.load(); const destination = this.destinations.find(d => d.id === destinationId); if (!destination) throw new BackupError("DESTINATION_UNKNOWN");
      const plan = planRetention(catalog, policy);
      for (const id of plan.deleteIds) {
        if (this.rows.some(r => r.archive.backupId === id && r.status !== "verified")) continue;
        await destination.delete(id);
        this.rows = this.rows.filter(r => !(r.archive.backupId === id && r.destinationId === destinationId));
        await this.save();
      }
      return plan;
    });
  }
}
