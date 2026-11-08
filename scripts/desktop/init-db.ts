import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applySqliteMigrations, upgradeSqlite, removeNewSqlite } from "./database-lifecycle";
import { sqliteFilePath } from "../../src/shared/db/sqlite-adapter";
import { seedDesktopDemo } from "./seed-demo";

export interface DesktopInitOptions { directory?: string; account?: {login:string;displayName:string;password:string}; mode?: "empty"|"demo" }
type InitStage = "DIRECTORY" | "LOCATION" | "SECRETS" | "MIGRATIONS" | "AI_DEFAULTS" | "ACCOUNT" | "PROBE";
const failureStages = new WeakMap<object, InitStage>();
const initCodes = ["ENOENT", "EACCES", "EPERM", "EINVAL", "ETIMEDOUT", "ENOBUFS", "ERR_DLOPEN_FAILED", "SQLITE_LOCAL_VOLUME_REQUIRED", "SQLITE_CLOUD_PATH_FORBIDDEN", "SQLITE_LOCAL_PATH_REQUIRED", "SQLITE_MIGRATION_HISTORY_MISMATCH", "SQLITE_INTEGRITY_FAILED", "DESKTOP_SECRETS_INVALID"];
/** Exact finite vocabulary only: never serialize errors, paths, SQL or secrets. */
export function desktopInitFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "INIT_DATABASE_FAILED";
  const stage = failureStages.get(error);
  if (!stage) return "INIT_DATABASE_FAILED";
  const code = "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  const safe = initCodes.find(value => value === code || value === message) ?? "OTHER";
  return `INIT_DATABASE_FAILED_STAGE_${stage}_CODE_${safe}`;
}
/** --initialize migrates/seeds public defaults; the UI explicitly creates the manager. */
export async function initializeDesktopDatabase(options: DesktopInitOptions = {}) {
  let stage: InitStage = "DIRECTORY";
  try {
  if(process.env.CRM_DEPLOYMENT_MODE!=="desktop") throw new Error("DESKTOP_REQUIRED");
  const directory=path.resolve(options.directory??process.env.DESKTOP_DATA_DIR??path.join(process.env.LOCALAPPDATA??"data","RealEstateCRM","data"));
  await mkdir(directory,{recursive:true});
  stage = "LOCATION";
  const file=sqliteFilePath(options.directory ? "file:"+path.join(directory,"crm.db") : process.env.DATABASE_URL??"file:"+path.join(directory,"crm.db"));
  stage = "SECRETS";
  const existed=existsSync(file);
  const secretFile=path.join(directory,"local-secrets.json");
  if(!existsSync(secretFile)) await writeFile(secretFile,JSON.stringify({deploymentId:process.env.DEPLOYMENT_ID??randomUUID(),instanceId:process.env.INSTANCE_ID??randomUUID(),localSecret:randomBytes(32).toString("base64url")}),{flag:"wx",mode:0o600});
  // Validate without printing secrets. Windows owner ACL is applied by the supervisor.
  const secrets=JSON.parse(await readFile(secretFile,"utf8"));
  if(!/^[A-Za-z0-9_-]{43}$/.test(secrets.localSecret)) throw new Error("DESKTOP_SECRETS_INVALID");
  // Native launcher already made a verified encrypted snapshot before starting migrations.
  stage = "MIGRATIONS";
  const upgrade=existed && process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1" ? await upgradeSqlite(file) : (applySqliteMigrations(file),null);
  stage = "AI_DEFAULTS";
  // prepareDesktopUpgrade invokes --initialize on EVERY launch, not only upgrades.
  // Use the resolved file directly; never load .env or touch the credential store.
  const {createSqliteClient}=await import("../../src/shared/db/sqlite-client");
  const {bootstrapAiTariffs}=await import("../../src/modules/ai/application/tariff-bootstrap");
  const defaultsDb=createSqliteClient("file:"+file);
  try { await bootstrapAiTariffs(defaultsDb); } finally { await defaultsDb.$disconnect(); }
  stage = "ACCOUNT";
  if(options.account) {
    const {resetConfigCache}=await import("../../src/shared/config/env");
    const {disconnectDb,getDb}=await import("../../src/shared/db/client");
    await disconnectDb(); process.env.DATABASE_URL="file:"+file; resetConfigCache();
    try {
      const {completeDesktopSetup}=await import("../../src/modules/desktop-setup/application/setup-service");
      await completeDesktopSetup({...options.account,mode:"empty",dataDirectory:"default",localDiskConfirmed:true});
      if(options.mode==="demo") {
        const db=getDb(), manager=await db.user.findFirstOrThrow({where:{roleCode:"manager"}});
        await seedDesktopDemo(db,manager.id);
      }
    } catch(error) { if(!existed) {await disconnectDb();removeNewSqlite(file);} throw error; }
    finally {await disconnectDb();}
  }
  stage = "PROBE";
  const probe=new Database(file,{readonly:true});
  let setupRequired:boolean;
  try {setupRequired=(probe.prepare("SELECT count(*) AS n FROM users").get() as {n:number}).n===0;} finally {probe.close();}
  return {file,created:!existed,snapshot:upgrade?.snapshot??null,setupRequired};
  } catch (error) {
    if (error && typeof error === "object") failureStages.set(error, stage);
    throw error;
  }
}
if(process.argv.includes("--initialize")) initializeDesktopDatabase().catch(error=>{console.error(desktopInitFailureCode(error));process.exitCode=1;});
if(process.argv.includes("--setup-stdin")) {
  // Passwords are never command arguments, stdout or .env.
  (async()=>{let body="";for await(const chunk of process.stdin) {body+=chunk;if(body.length>16384)throw new Error("INPUT_LIMIT");}
    await initializeDesktopDatabase(JSON.parse(body));console.log("DESKTOP_INITIALIZED");})().catch(()=>{console.error("INIT_DATABASE_FAILED");process.exitCode=1;});
}
