import { normalizeSqliteRawResult } from "./dialect";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient as SqliteClient } from "@/generated/prisma-sqlite/client";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import metadata from "../../../prisma/sqlite/compatibility.json";
import { DesktopSqliteAdapter, sqliteFilePath } from "./sqlite-adapter";
import { toSqliteUnits, fromSqliteUnits } from "./sqlite-money";

type Meta = { table: string; columns: Record<string,string>; lists: Record<string, { type: string; column: string }>; decimals: Record<string, { precision: number; scale: number; column: string }>; relations: Record<string, string> };
const models: Record<string, Meta> = metadata.models;
const envelopes = new Set(["where","data","AND","OR","NOT","create","createMany","update","updateMany","upsert","connect","connectOrCreate","disconnect","delete","deleteMany","some","none","every","is","isNot","cursor","having"]);
const context = new AsyncLocalStorage<string>();
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (context.getStore() === key) return work();
  const result = (queues.get(key) ?? Promise.resolve()).then(() => context.run(key, work));
  queues.set(key, result.catch(() => undefined));
  return result;
}
function decimalInput(value: unknown, spec: { precision: number; scale: number }): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object" || value instanceof Prisma.Decimal) return toSqliteUnits(value, spec);
  return Object.fromEntries(Object.entries(value).map(([op, v]) => {
    if (op === "in" || op === "notIn") return [op, (v as unknown[]).map(x => decimalInput(x, spec))];
    if (!["equals","not","lt","lte","gt","gte","set","increment","decrement"].includes(op)) throw new Error("SQLITE_DECIMAL_OPERATION_UNSUPPORTED");
    return [op, decimalInput(v, spec)];
  }));
}
function input(model: string, value: unknown, projection = false): unknown {
  if (Array.isArray(value)) return value.map(v => input(model, v, projection));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Prisma.Decimal) return value;
  const meta = models[model]!;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (meta.decimals[key] && !projection) out[key] = decimalInput(v, meta.decimals[key]);
    else if (meta.lists[key] && !projection) {
      const list = v && !Array.isArray(v) && typeof v === "object" && "set" in v ? (v as {set: unknown}).set : v;
      if (!Array.isArray(list) || list.some(x => meta.lists[key]!.type === "Int" ? !Number.isSafeInteger(x) : typeof x !== "string")) throw new Error("SQLITE_LIST_FILTER_OR_VALUE_UNSUPPORTED");
      out[key] = list;
    } else if (meta.relations[key]) out[key] = input(meta.relations[key], v, false);
    else if (key === "select" || key === "include" || key === "orderBy" || key.startsWith("_")) out[key] = input(model, v, true);
    else if (envelopes.has(key)) out[key] = input(model, v, projection);
    else if (v && typeof v === "object" && !Array.isArray(v) && "mode" in v) {
      const { mode, ...filter } = v as Record<string, unknown>;
      if (mode !== "insensitive" && mode !== "default") throw new Error("SQLITE_STRING_MODE_UNSUPPORTED");
      // Equality must not become contains; an exact Unicode comparison is
      // implemented by exact Unicode lower() candidate IDs below.
      if (mode === "insensitive" && ("equals" in filter || "in" in filter || "notIn" in filter)) throw new Error("SQLITE_INSENSITIVE_EQUALITY_UNSUPPORTED");
      out[key] = filter;
    } else out[key] = v;
  }
  return out;
}
function output(model: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map(v => output(model, v));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Prisma.Decimal) return value;
  const meta = models[model]!;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => {
    if (meta.decimals[key] && typeof v === "bigint") return [key, fromSqliteUnits(v, meta.decimals[key])];
    if (meta.relations[key]) return [key, output(meta.relations[key], v)];
    if (key.startsWith("_") && key !== "_count") return [key, output(model, v)];
    return [key, v];
  }));
}
export function createSqliteClient(url: string): PrismaClient {
  const file = sqliteFilePath(url);
  const queueKey = process.platform === "win32" ? file.toLowerCase() : file;
  const adapter = new DesktopSqliteAdapter({ url: "file:" + file }, { timestampFormat: "unixepoch-ms" });
  const native = new SqliteClient({ adapter });
  const extended = native.$extends({ query: { $allOperations: async ({ model, args, query, operation }) => {
    return serialized(queueKey, async () => {
      if (!model) return normalizeSqliteRawResult(await query(args));
      if (operation === "aggregate" && (args as Record<string, unknown>)._avg) throw new Error("SQLITE_DECIMAL_AVERAGE_UNSUPPORTED");
      await native.$connect();
      const patched = resolveSpecialFilters(model, args, adapter);
      return output(model, await query(input(model, patched) as typeof args));
    });
  } } });
  return new Proxy(extended, {
    get(target, prop) {
      if (prop === "$transaction") return (work: unknown, options?: Record<string, unknown>) => serialized(queueKey, async () => {
        if (typeof work !== "function") throw new Error("SQLITE_BATCH_TRANSACTION_UNSUPPORTED");
        const opts = { ...options };
        if (opts.isolationLevel) {
          if (!["ReadCommitted","RepeatableRead","Serializable"].includes(String(opts.isolationLevel))) throw new Error("SQLITE_ISOLATION_UNSUPPORTED");
          opts.isolationLevel = "Serializable";
        }
        // PG-typed facade; conversion is applied to every query inside tx too.
        return (target.$transaction as unknown as (work: unknown, options: Record<string,unknown>) => Promise<unknown>)(work, opts);
      });
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
}


/** Resolve unsupported Prisma filters to candidate IDs on the SAME native connection.
 * Outer AND/OR/NOT and relation predicates remain intact, preserving RBAC.
 */
function resolveSpecialFilters(model: string, value: unknown, adapter: DesktopSqliteAdapter): unknown {
  if (Array.isArray(value)) return value.map(v => resolveSpecialFilters(model,v,adapter));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Prisma.Decimal) return value;
  const meta = models[model]!, out: Record<string,unknown> = {};
  const extra: unknown[] = [];
  for (const [key,v] of Object.entries(value)) {
    const filter = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : null;
    if (model === "Document" && key === "valuesSnapshot" && filter && ("array_contains" in filter || "path" in filter)) {
      if (JSON.stringify(filter.path) !== '["accessRoles"]' || !Array.isArray(filter.array_contains) || filter.array_contains.some(x=>typeof x!=="string") || Object.keys(filter).some(k=>k!=="path"&&k!=="array_contains")) throw new Error("SQLITE_JSON_FILTER_UNSUPPORTED");
      const roles = filter.array_contains as string[];
      const rows = adapter.connection!.prepare("SELECT id FROM documents WHERE " + (roles.length ? roles.map(()=>"EXISTS(SELECT 1 FROM json_each(values_snapshot,'$.accessRoles') WHERE value=?)").join(" AND ") : "1")).all(...roles) as {id:string}[];
      extra.push({id:{in:rows.map(r=>r.id)}});
    } else if (filter?.mode === "insensitive" && "equals" in filter) {
      if (Object.keys(filter).some(k=>k!=="mode"&&k!=="equals") || typeof filter.equals !== "string" || !meta.columns[key]) throw new Error("SQLITE_INSENSITIVE_EQUALITY_UNSUPPORTED");
      const rows=adapter.connection!.prepare('SELECT id FROM "'+meta.table+'" WHERE lower("'+meta.columns[key]+'")=lower(?)').all(filter.equals) as {id:string}[];
      extra.push({id:{in:rows.map(r=>r.id)}});
    } else if (meta.relations[key]) out[key]=resolveSpecialFilters(meta.relations[key],v,adapter);
    else if (envelopes.has(key) || key==="include" || key==="select") out[key]=resolveSpecialFilters(model,v,adapter);
    else out[key]=v;
  }
  if(extra.length) out.AND=[...(Array.isArray(out.AND)?out.AND:out.AND?[out.AND]:[]),...extra];
  return out;
}

