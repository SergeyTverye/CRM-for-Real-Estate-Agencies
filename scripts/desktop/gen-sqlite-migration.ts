import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import metadata from "../../prisma/sqlite/compatibility.json";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
let sql = execFileSync(npx, ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/sqlite/schema.prisma", "--script", "--config", "prisma/sqlite.config.ts"], { encoding: "utf8", shell: process.platform === "win32" });
const checks = new Map<string, {table: string; expression: string}>();
for (const dir of readdirSync("prisma/migrations").sort()) {
  if (dir === "migration_lock.toml") continue;
  const pg = readFileSync("prisma/migrations/" + dir + "/migration.sql", "utf8");
  const events = /ALTER TABLE\s+"?(\w+)"?\s+(?:ADD CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*(\([\s\S]*?\))\s*;|DROP CONSTRAINT(?: IF EXISTS)?\s+"?(\w+)"?\s*;)/g;
  for (const match of pg.matchAll(events)) {
    if (match[4]) checks.delete(match[1] + "." + match[4]);
    else checks.set(match[1] + "." + match[2], { table: match[1]!, expression: match[3]! });
  }
}
const tableChecks = new Map<string,string[]>();
for (const [key, check] of checks) {
  let expr = check.expression.replace(/\bjsonb_typeof\b/g,"json_type").replace(/\bbtrim\b/g,"trim");
  if (key.endsWith(".tasks_reminder_offsets_check")) continue; // json_each requires trigger, not CHECK.
  if (key.endsWith(".interactive_browser_sessions_host_check")) expr = '(length("start_url_host") BETWEEN 1 AND 253 AND "start_url_host" NOT GLOB \'*[^A-Za-z0-9.-]*\' AND substr("start_url_host",1,1) GLOB \'[A-Za-z0-9]\' AND substr("start_url_host",-1,1) GLOB \'[A-Za-z0-9]\')';
  if (key.endsWith(".property_owners_share_check")) expr = expr.replace('"ownership_share" <= 1','"ownership_share" <= 10000');
  const values = tableChecks.get(check.table) ?? [];
  values.push('CONSTRAINT "' + key.split(".")[1] + '" CHECK ' + expr);
  tableChecks.set(check.table,values);
}
for (const [model, meta] of Object.entries(metadata.models)) {
  const values = tableChecks.get(meta.table) ?? [];
  for (const [field, spec] of Object.entries(meta.decimals)) values.push('CONSTRAINT "'+model+"_"+field+'_exact" CHECK ("'+spec.column+'" IS NULL OR (typeof("'+spec.column+'") = \'integer\' AND abs("'+spec.column+'") < '+10n ** BigInt(spec.precision)+'))');
  for (const [field, spec] of Object.entries(meta.lists)) values.push('CONSTRAINT "'+model+"_"+field+'_array" CHECK (json_valid("'+spec.column+'") AND json_type("'+spec.column+'") = \'array\')');
  tableChecks.set(meta.table,values);
}
tableChecks.set("document_templates", [...(tableChecks.get("document_templates") ?? []), 'CONSTRAINT "document_templates_current_version_owner_fkey" FOREIGN KEY ("current_version_id","id") REFERENCES "document_template_versions"("id","template_id") ON DELETE RESTRICT ON UPDATE RESTRICT']);
tableChecks.set("ai_chat_messages", [...(tableChecks.get("ai_chat_messages") ?? []), 'CONSTRAINT "ai_chat_messages_pending_action_session_fkey" FOREIGN KEY ("pending_action_id","session_id") REFERENCES "ai_pending_actions"("id","session_id") ON DELETE RESTRICT ON UPDATE RESTRICT']);
sql = sql.replace(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g, (_all,table:string,body:string) =>
  'CREATE TABLE "'+table+'" ('+body+(tableChecks.get(table)?.length ? ",\n    "+tableChecks.get(table)!.join(",\n    ") : "")+'\n);');
sql = sql.replace(/DEFAULT (\{\}|\[\])/g, (_s, json: string) => "DEFAULT '"+json+"'");
sql = sql.replace(/DEFAULT CURRENT_TIMESTAMP/g, "DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))");
sql += readFileSync("prisma/sqlite/constraints.sql","utf8");
const dir="prisma/sqlite/migrations/20261106130000_desktop_core";
mkdirSync(dir,{recursive:true});
writeFileSync(dir+"/migration.sql",sql);
writeFileSync("prisma/sqlite/migrations/migration_lock.toml",'provider = "sqlite"\n');
console.log("SQLite baseline: "+checks.size+" active PG checks + integer/list constraints + manual indexes/triggers");

