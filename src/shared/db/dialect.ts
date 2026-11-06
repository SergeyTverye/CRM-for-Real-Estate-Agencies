import { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
export function isSqlite() { return getConfig().CRM_DEPLOYMENT_MODE === "desktop"; }
export function dialectSql(pg: Prisma.Sql, sqlite: Prisma.Sql) { return isSqlite() ? sqlite : pg; }
const constantSql = (sql: string) => Prisma.sql([sql] as unknown as TemplateStringsArray);
const rebuild = (pg: Prisma.Sql, strings: string[]) => Prisma.sql(strings as unknown as TemplateStringsArray, ...pg.values);

/** SQLite facade queues the entire transaction and acquires BEGIN IMMEDIATE. */
export function lockSql(pg: Prisma.Sql): Prisma.Sql {
  if (!isSqlite()) return pg;
  const text = pg.strings.join("?");
  if (text.includes("pg_try_advisory_xact_lock")) return constantSql("SELECT 1 AS locked");
  if (text.includes("pg_advisory_xact_lock")) return constantSql("SELECT 1");
  return rebuild(pg, pg.strings.map(s => s.replace(/::uuid\b/g, "").replace(/ FOR (?:UPDATE|SHARE)(?: SKIP LOCKED)?/g, "")));
}
/** Explicit planner grammar, covered against the scoped calendar projection. */
export function plannerSql(pg: Prisma.Sql): Prisma.Sql {
  if (!isSqlite()) return pg;
  return rebuild(pg, pg.strings.map(s => s
    .replace(/count\(\*\)( FILTER\(WHERE [^)]*\))?::int/g, "CAST(count(*)$1 AS INT)").replace(/::uuid\b/g, "")
    .replace(/\(v\.at::timestamp AT TIME ZONE /g, "crm_date_at_zone(v.value, ")
    .replace("CROSS JOIN LATERAL (VALUES(a.valid_from),(a.valid_until)) v(at)", "JOIN json_each(json_array(a.valid_from,a.valid_until)) v ON v.value IS NOT NULL")
    .replace("to_char(at AT TIME ZONE ", "crm_local_day(at, ")
    .replace(",'YYYY-MM-DD')", ")")));
}
/** Search SQL has an explicit equivalent; correlated latest-snapshot join uses its index. */
export function searchSql(pg: Prisma.Sql): Prisma.Sql {
  if (!isSqlite()) return pg;
  return rebuild(pg, pg.strings.map(s => s
    .replace("LEFT JOIN LATERAL (SELECT * FROM external_listing_snapshots s0 WHERE s0.search_run_id=r.run_id AND s0.listing_id=r.listing_id ORDER BY s0.fetched_at DESC,s0.id ASC LIMIT 1) s ON true",
      "LEFT JOIN external_listing_snapshots s ON s.id=(SELECT s0.id FROM external_listing_snapshots s0 WHERE s0.search_run_id=r.run_id AND s0.listing_id=r.listing_id ORDER BY s0.fetched_at DESC,s0.id ASC LIMIT 1)")
    .replace(/::uuid\b/g, "")
    .replaceAll("s.normalized->>'priceUnit'", "json_extract(s.normalized,'$.priceUnit')")));
}
export function scalarSql(pg: Prisma.Sql): Prisma.Sql {
  if (!isSqlite()) return pg;
  return rebuild(pg, pg.strings.map(s => s.replace(/count\((\*|DISTINCT \w+)\)( FILTER \(WHERE [^)]*\))?::int/g, "CAST(count($1)$2 AS INT)").replace(/::(?:uuid|bigint)\b/g, "")));
}
export function reactivationSql(pg: Prisma.Sql): Prisma.Sql {
  if (!isSqlite()) return pg;
  return rebuild(pg, pg.strings.map((part,i) => {
    const previousInterval = pg.strings[i-1]?.endsWith("make_interval(days => ");
    return (previousInterval ? part.replace(/^\)/, " * 86400000)") : part)
      .replace(/::uuid\b/g, "").replace(/make_interval\(days => /g, "(");
  }));
}


/** Raw SQLite expression integers are Int64 in Prisma; preserve existing DTOs. */
export function normalizeSqliteRawResult(value: unknown): unknown {
  const numberColumns = new Set(["total","red","yellow","green","gray","calls","clients","needs","showings","deals"]);
  if (!Array.isArray(value)) return value;
  return value.map(row => {
    if (!row || typeof row !== "object") return row;
    return Object.fromEntries(Object.entries(row).map(([key,v]) => {
      if ((key === "at" || key === "finished_at") && (typeof v === "bigint" || typeof v === "number")) return [key, new Date(Number(v))];
      if (numberColumns.has(key) && typeof v === "bigint") {
        const n=Number(v);
        if (!Number.isSafeInteger(n)) throw new Error("SQLITE_RAW_COUNT_RANGE");
        return [key,n];
      }
      if ((key==="locked"||key==="resumable") && (typeof v==="bigint"||typeof v==="number")) return [key,Boolean(v)];
      return [key,v];
    }));
  });
}

