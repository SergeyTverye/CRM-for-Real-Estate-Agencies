import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import metadata from "../../prisma/sqlite/compatibility.json";

/**
 * Deterministic LF normalization for SQLite migration generation.
 *
 * Raw migration bytes are checksummed strictly (see applySqliteMigrations in
 * scripts/desktop/database-lifecycle.ts), so CRLF from Windows checkouts,
 * child-process stdout, or imported SQL seeds break history matching across
 * hosts without changing any SQL semantics. Every raw SQL boundary of this
 * generator is normalized to LF; SQL content is otherwise untouched and history
 * validation is never bypassed or rewritten.
 */
export function normalizeSqlToLf(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function buildSqliteMigrationSql(diffSql: string, pgSqlList: string[], constraintsSql: string): { sql: string; pgCheckCount: number } {
  const checks = new Map<string, {table: string; expression: string}>();
  for (const pgRaw of pgSqlList) {
    const pg = normalizeSqlToLf(pgRaw);
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
  let sql = normalizeSqlToLf(diffSql);
  sql = sql.replace(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g, (_all,table:string,body:string) =>
    'CREATE TABLE "'+table+'" ('+body+(tableChecks.get(table)?.length ? ",\n    "+tableChecks.get(table)!.join(",\n    ") : "")+'\n);');
  sql = sql.replace(/DEFAULT (\{\}|\[\])/g, (_s, json: string) => "DEFAULT '"+json+"'");
  sql = sql.replace(/DEFAULT CURRENT_TIMESTAMP/g, "DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))");
  sql += normalizeSqlToLf(constraintsSql);
  return { sql: normalizeSqlToLf(sql), pgCheckCount: checks.size };
}

export type BaselineWriteAction = "create" | "identical" | "normalize-line-endings";

export interface BaselineWriteDecision {
  action: BaselineWriteAction;
  /** Canonical bytes to write; null when no write is needed. */
  sqlToWrite: string | null;
}

const BASELINE_DRIFT_MESSAGE =
  "Refusing to overwrite applied SQLite baseline: generated SQL differs semantically " +
  "(normalized LF comparison). Schema drift must go to a new incremental migration, " +
  "never to a baseline rewrite.";

/**
 * Fail-closed guard for the already-applied immutable baseline.
 *
 * - Baseline absent -> caller may initialize it with the generated SQL.
 * - Baseline present and semantically identical after LF normalization:
 *   identical bytes -> no write; LF/CRLF-only difference -> canonical LF rewrite allowed.
 * - Baseline present and semantically different -> throw before any write, leaving
 *   the applied baseline untouched.
 */
export function resolveBaselineWrite(
  existingRaw: string | null | undefined,
  generatedSql: string,
): BaselineWriteDecision {
  if (existingRaw === null || existingRaw === undefined) {
    return { action: "create", sqlToWrite: generatedSql };
  }
  const normalizedExisting = normalizeSqlToLf(existingRaw);
  const normalizedGenerated = normalizeSqlToLf(generatedSql);
  if (normalizedExisting === normalizedGenerated) {
    if (existingRaw === generatedSql) return { action: "identical", sqlToWrite: null };
    return { action: "normalize-line-endings", sqlToWrite: normalizedExisting };
  }
  throw new Error(BASELINE_DRIFT_MESSAGE);
}

/**
 * Bounded writer applying {@link resolveBaselineWrite} to a baseline file.
 * Never overwrites a semantically different applied baseline.
 */
export function writeBaselineSql(baselinePath: string, generatedSql: string): BaselineWriteAction {
  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, generatedSql);
    return "create";
  }
  const existingRaw = readFileSync(baselinePath, "utf8");
  const decision = resolveBaselineWrite(existingRaw, generatedSql);
  if (decision.sqlToWrite !== null) writeFileSync(baselinePath, decision.sqlToWrite);
  return decision.action;
}

function main() {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const diffSql = execFileSync(npx, ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/sqlite/schema.prisma", "--script", "--config", "prisma/sqlite.config.ts"], { encoding: "utf8", shell: process.platform === "win32" });
  const pgSqlList = readdirSync("prisma/migrations").sort().filter((dir) => dir !== "migration_lock.toml").map((dir) => readFileSync("prisma/migrations/" + dir + "/migration.sql", "utf8"));
  const constraintsSql = readFileSync("prisma/sqlite/constraints.sql","utf8");
  const { sql, pgCheckCount } = buildSqliteMigrationSql(diffSql, pgSqlList, constraintsSql);
  const dir="prisma/sqlite/migrations/20261106130000_desktop_core";
  mkdirSync(dir,{recursive:true});
  const baselinePath = dir+"/migration.sql";
  const action = writeBaselineSql(baselinePath, sql);
  writeFileSync("prisma/sqlite/migrations/migration_lock.toml",'provider = "sqlite"\n');
  console.log("SQLite baseline (" + action + "): "+pgCheckCount+" active PG checks + integer/list constraints + manual indexes/triggers");
}

const invokedAsScript = (process.argv[1] ?? "").replaceAll("\\", "/").endsWith("scripts/desktop/gen-sqlite-migration.ts");
if (invokedAsScript) main();
