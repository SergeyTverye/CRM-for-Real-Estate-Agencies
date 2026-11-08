import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { sqliteFilePath } from "../../src/shared/db/sqlite-adapter";

/** Official Prisma migration history, shared by installation, transfer and tests. */
export function applySqliteMigrations(file: string) {
  file = sqliteFilePath("file:" + resolve(file));
  mkdirSync(dirname(file), {recursive:true});
  new Database(file).close();
  const db = new Database(file);
  try {
    db.pragma("foreign_keys=ON"); db.pragma("busy_timeout=10000");
    db.exec(`CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME,
      migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
    for (const name of readdirSync(resolve("prisma/sqlite/migrations")).filter(n=>/^\d/.test(n)).sort()) {
      const sql=readFileSync(resolve("prisma/sqlite/migrations",name,"migration.sql"),"utf8");
      const checksum=createHash("sha256").update(sql).digest("hex");
      const applied=db.prepare("SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=? AND rolled_back_at IS NULL").all(name) as {checksum:string;finished_at:unknown}[];
      if(applied.length) { if(applied.length!==1 || !applied[0]!.finished_at || applied[0]!.checksum!==checksum) throw new Error("SQLITE_MIGRATION_HISTORY_MISMATCH"); continue; }
      // Table rebuilds must preserve referencing business history. Disable FK
      // actions outside the transaction, then validate before committing.
      const rebuilding = sql.startsWith("-- rebuild-with-foreign-key-check");
      if (rebuilding) db.pragma("foreign_keys=OFF");
      try { db.transaction(()=>{
        db.exec(sql);
        if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("SQLITE_FOREIGN_KEY_CHECK_FAILED");
        db.prepare("INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES(?,?,?,?,?,1)").run(randomUUID(),checksum,Date.now(),name,Date.now());
      }).immediate(); } finally { if (rebuilding) db.pragma("foreign_keys=ON"); }
    }
    if (db.pragma("integrity_check",{simple:true}) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("SQLITE_INTEGRITY_FAILED");
  } finally { db.close(); }
}

/** Never overwrite an existing target. Removal is restricted to files created by caller. */
export function removeNewSqlite(file: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) if (existsSync(file+suffix)) rmSync(file+suffix);
}
export async function upgradeSqlite(file: string) {
  file = sqliteFilePath("file:" + resolve(file));
  if (!existsSync(file)) throw new Error("SQLITE_DATABASE_MISSING");
  const snapshot = file + ".before-update-" + Date.now();
  const db = new Database(file);
  try { await db.backup(snapshot); } finally { db.close(); }
  // On failure retain the protective snapshot and the migration error for recovery.
  applySqliteMigrations(file);
  return {snapshot};
}
