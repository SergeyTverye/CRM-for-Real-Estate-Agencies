import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { sqliteFilePath } from "../../src/shared/db/sqlite-adapter";
const file = sqliteFilePath(process.env.SQLITE_DATABASE_URL ?? "file:" + resolve("data/desktop/crm.db"));
new Database(file).close();
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma","migrate","deploy","--config","prisma/sqlite.config.ts"], {
    env: { ...process.env, SQLITE_DATABASE_URL: "file:" + file.replaceAll("\\","/") },
    stdio: "inherit", shell: process.platform === "win32",
  });

