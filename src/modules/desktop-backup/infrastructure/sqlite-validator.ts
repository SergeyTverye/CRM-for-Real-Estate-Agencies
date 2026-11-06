import Database from "better-sqlite3";
import { BackupError, type SnapshotValidator } from "../domain/contracts";
/** No dependency on PostgreSQL or a live application connection. */
export class SqliteSnapshotValidator implements SnapshotValidator {
  async validate(file: string) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new BackupError("SQLITE_INTEGRITY");
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new BackupError("SQLITE_FOREIGN_KEYS");
    } finally { db.close(); }
  }
}
