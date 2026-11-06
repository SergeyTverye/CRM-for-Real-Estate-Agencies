import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
const dir = mkdtempSync(join(tmpdir(),"crm-sqlite-core-"));
process.env.DATABASE_URL = "file:" + join(dir,"core.db");
process.env.CRM_DEPLOYMENT_MODE = "desktop";
process.env.FILE_STORAGE_PATH = join(dir,"files");
process.env.AI_ENABLED = "true";
process.env.YANDEX_AI_MAX_MONTHLY_COST_RUB = "1000";
const native = new Database(join(dir,"core.db"));
native.pragma("foreign_keys=ON");
for (const migration of readdirSync("prisma/sqlite/migrations").sort().filter(n=>n!=="migration_lock.toml"))
  native.exec(readFileSync("prisma/sqlite/migrations/"+migration+"/migration.sql","utf8"));
native.close();

