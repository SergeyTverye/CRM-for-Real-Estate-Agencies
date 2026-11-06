import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applySqliteMigrations, upgradeSqlite, removeNewSqlite } from "./database-lifecycle";
import { sqliteFilePath } from "../../src/shared/db/sqlite-adapter";
import { seedDesktopDemo } from "./seed-demo";

export interface DesktopInitOptions { directory?: string; account?: {login:string;displayName:string;password:string}; mode?: "empty"|"demo" }
/** --initialize only migrates; the UI then explicitly creates the manager via setup API. */
export async function initializeDesktopDatabase(options: DesktopInitOptions = {}) {
  if(process.env.CRM_DEPLOYMENT_MODE!=="desktop") throw new Error("DESKTOP_REQUIRED");
  const directory=path.resolve(options.directory??process.env.DESKTOP_DATA_DIR??path.join(process.env.LOCALAPPDATA??"data","RealEstateCRM","data"));
  await mkdir(directory,{recursive:true});
  const file=sqliteFilePath(options.directory ? "file:"+path.join(directory,"crm.db") : process.env.DATABASE_URL??"file:"+path.join(directory,"crm.db"));
  const existed=existsSync(file);
  const secretFile=path.join(directory,"local-secrets.json");
  if(!existsSync(secretFile)) await writeFile(secretFile,JSON.stringify({deploymentId:process.env.DEPLOYMENT_ID??randomUUID(),instanceId:process.env.INSTANCE_ID??randomUUID(),localSecret:randomBytes(32).toString("base64url")}),{flag:"wx",mode:0o600});
  // Validate without printing secrets. Windows owner ACL is applied by the supervisor.
  const secrets=JSON.parse(await readFile(secretFile,"utf8"));
  if(!/^[A-Za-z0-9_-]{43}$/.test(secrets.localSecret)) throw new Error("DESKTOP_SECRETS_INVALID");
  // Native launcher already made a verified encrypted snapshot before starting migrations.
  const upgrade=existed && process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1" ? await upgradeSqlite(file) : (applySqliteMigrations(file),null);
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
  const probe=new Database(file,{readonly:true});
  let setupRequired:boolean;
  try {setupRequired=(probe.prepare("SELECT count(*) AS n FROM users").get() as {n:number}).n===0;} finally {probe.close();}
  return {file,created:!existed,snapshot:upgrade?.snapshot??null,setupRequired};
}
if(process.argv.includes("--initialize")) initializeDesktopDatabase().catch(()=>{console.error("INIT_DATABASE_FAILED");process.exitCode=1;});
if(process.argv.includes("--setup-stdin")) {
  // Passwords are never command arguments, stdout or .env.
  (async()=>{let body="";for await(const chunk of process.stdin) {body+=chunk;if(body.length>16384)throw new Error("INPUT_LIMIT");}
    await initializeDesktopDatabase(JSON.parse(body));console.log("DESKTOP_INITIALIZED");})().catch(()=>{console.error("INIT_DATABASE_FAILED");process.exitCode=1;});
}
