import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, copyFile, rm, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createArchive, extractArchive } from "../../../src/modules/desktop-backup/infrastructure/archive";
import { SqliteSnapshotValidator } from "../../../src/modules/desktop-backup/infrastructure/sqlite-validator";
import { WindowsDpapiProtector } from "../../../src/modules/desktop-backup/infrastructure/credential-store";
import { newRecoveryKey } from "../../../src/modules/desktop-backup/infrastructure/encryption";
const root = () => process.env.DESKTOP_DATA_DIR!;
const database = () => path.join(root(),"crm.db");
const marker = () => path.join(root(),"desktop-version.json");
const journal = () => path.join(root(),"pending-upgrade.json");
const validator = new SqliteSnapshotValidator();
const protector = new WindowsDpapiProtector();
interface Pending { archive: string; credential: string; previous: string | null }
async function credentials() {
  const file = path.join(root(),"upgrade-key.dpapi");
  if (!existsSync(file)) {
    const bytes = randomBytes(48);
    try { await writeFile(file,await protector.seal(bytes,"desktop-upgrade"),{flag:"wx",mode:0o600}); } finally { bytes.fill(0); }
  }
  return protector.open(await readFile(file),"desktop-upgrade");
}
/** Native supervisor has stopped ALL writers before entering this function.
 * These local safety copies use a DPAPI recovery key; portable user backups have their own workflow. */
export async function createDesktopSafetySnapshot() {
  const previous = existsSync(marker()) ? await readFile(marker(),"utf8") : null;
  const identity = JSON.parse(await readFile(path.join(root(),"identity.json"),"utf8"));
  const key = await credentials();
  const recoveryFile = path.join(root(), "upgrade-recovery.dpapi");
  if (!existsSync(recoveryFile)) {
    const bytes = Buffer.from(newRecoveryKey());
    try { await writeFile(recoveryFile, await protector.seal(bytes, "desktop-upgrade-recovery"), {flag:"wx",mode:0o600}); } finally { bytes.fill(0); }
  }
  const recovery = await protector.open(await readFile(recoveryFile), "desktop-upgrade-recovery");
  try {
    return await createArchive({
      outputDir:process.env.BACKUP_PATH!, stagingRoot:path.join(root(),"upgrade-staging"),
      source:{ async createConsistentSnapshot(dest) { const db = new Database(database()); try { await db.backup(dest); } finally { db.close(); } } },
      barrier:{ run: async work => work() }, validator,
      metadata:{ ...identity, snapshotRevision:0, parentBackupId:null, crmVersion:JSON.parse(previous ?? "{}").version ?? "pre-desktop", schemaVersion:1 },
      passphrase:key.toString("base64"), recoveryKey:recovery.toString("utf8"), recoveryKeySaved:true,
      settings:{timeZone:process.env.APP_TIMEZONE}, storage:{documents:process.env.FILE_STORAGE_PATH!},
    });
  } finally { key.fill(0); recovery.fill(0); }
}
export async function prepareDesktopUpgrade() {
  if (existsSync(journal())) await rollbackDesktopUpgrade();
  const current = process.env.APP_VERSION!;
  const previous = existsSync(marker()) ? await readFile(marker(),"utf8") : null;
  if (existsSync(database()) && JSON.parse(previous ?? "{}").version !== current) {
    const result = await createDesktopSafetySnapshot();
    await writeFile(journal(),JSON.stringify({archive:result.path,credential:"upgrade-key.dpapi",previous}),{flag:"wx",mode:0o600});
  }
  try {
    const result = await new Promise<number | null>((resolve,reject) => {
      const child = spawn(process.execPath,[path.join(process.cwd(),"init-db.cjs"),"--initialize"],{env:process.env,stdio:"inherit",windowsHide:true});
      child.on("exit",resolve); child.on("error",reject);
    });
    if (result !== 0) throw Error("MIGRATION_FAILED");
    await validator.validate(database());
  } catch (error) { await rollbackDesktopUpgrade(); throw error; }
}
export async function finishDesktopUpgrade() {
  const temp = marker() + ".tmp";
  await writeFile(temp,JSON.stringify({version:process.env.APP_VERSION}),{mode:0o600});
  await rename(temp,marker());
  await rm(journal(),{force:true});
}
export async function rollbackDesktopUpgrade() {
  if (!existsSync(journal())) return;
  const pending = JSON.parse(await readFile(journal(),"utf8")) as Pending;
  if (path.dirname(path.resolve(pending.archive)) !== path.resolve(process.env.BACKUP_PATH!)) throw Error("UPGRADE_ARCHIVE_SCOPE");
  const key = await credentials();
  try {
    const extracted = await extractArchive({archivePath:pending.archive,stagingRoot:path.join(root(),"upgrade-staging"),credential:{passphrase:key.toString("base64")},validator,schemaVersion:1});
    try {
      await mkdir(root(),{recursive:true});
      await rm(database()+"-wal",{force:true}); await rm(database()+"-shm",{force:true});
      const temp = database()+".restore";
      await copyFile(path.join(extracted.stage,"database.sqlite"),temp);
      await rename(temp,database());
      // Migrations never write storage; encrypted snapshot retains all attachments too.
      if (pending.previous) await writeFile(marker(),pending.previous,{mode:0o600});
      else await rm(marker(),{force:true});
      await rm(journal(),{force:true});
    } finally { await extracted.dispose(); }
  } finally { key.fill(0); }
}
