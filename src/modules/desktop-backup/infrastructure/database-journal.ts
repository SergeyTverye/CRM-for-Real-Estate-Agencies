import { db } from "@/shared/db/client";
import { BackupError } from "../domain/contracts";
import { journalSchema, type ReplicationJournal, type ReplicationRow } from "../application/replication-queue";

export class DatabaseReplicationJournal implements ReplicationJournal {
  constructor(private readonly id = "portable-replication-v1") {}
  async read() {
    const row = await db.backupQueueJournal.upsert({ where: { id: this.id }, create: { id: this.id, payload: { version: 1, rows: [] } }, update: {} });
    return { revision: row.revision, rows: journalSchema.parse(row.payload).rows };
  }
  async save(revision: number, rows: ReplicationRow[]) {
    const payload = journalSchema.parse({ version: 1, rows });
    const result = await db.backupQueueJournal.updateMany({ where: { id: this.id, revision }, data: { payload, revision: { increment: 1 } } });
    if (result.count !== 1) throw new BackupError("QUEUE_REVISION_CONFLICT");
    return revision + 1;
  }
}
