import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
const dir=mkdtempSync(join(tmpdir(),"crm-sqlite-migrate-"));
const file=join(dir,"migration.db");
new Database(file).close();
for(let i=0;i<2;i++){
  execFileSync(process.platform==="win32"?"npx.cmd":"npx",["prisma","migrate","deploy","--config","prisma/sqlite.config.ts"],{
    env:{...process.env,SQLITE_DATABASE_URL:"file:"+file.replaceAll("\\","/")},stdio:"pipe",shell:process.platform==="win32",
  });
}
const db=new Database(file);
if(db.pragma("integrity_check",{simple:true})!=="ok")throw new Error("SQLITE_INTEGRITY_FAILED");
const migrations=db.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL").get() as {count:number};
const tables=db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'").get() as {count:number};
if(migrations.count!==1||tables.count!==84)throw new Error("SQLITE_MIGRATION_COUNTS");
db.close();
console.log("Prisma migrate deploy: clean + repeat PASS; 84 models; integrity_check=ok");

