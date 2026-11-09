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
export function serializeSqliteWork<T>(url: string, work: () => Promise<T>) {
  const file = sqliteFilePath(url);
  return serialized(process.platform === "win32" ? file.toLowerCase() : file, work);
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
function input(model: string, value: unknown, projection = false, dataContext = false): unknown {
  if (Array.isArray(value)) return value.map(v => input(model, v, projection, dataContext));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Prisma.Decimal) return value;
  const meta = models[model]!;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (meta.decimals[key] && !projection) out[key] = decimalInput(v, meta.decimals[key]);
    else if (meta.lists[key] && !projection) {
      const list = v && !Array.isArray(v) && typeof v === "object" && "set" in v ? (v as {set: unknown}).set : v;
      if (!Array.isArray(list) || list.some(x => meta.lists[key]!.type === "Int" ? !Number.isSafeInteger(x) : typeof x !== "string")) throw new Error("SQLITE_LIST_FILTER_OR_VALUE_UNSUPPORTED");
      out[key] = list;
    } else if (meta.relations[key]) out[key] = input(meta.relations[key], v, false, dataContext);
    else if (key === "select" || key === "include" || key === "orderBy" || key.startsWith("_")) out[key] = input(model, v, true, dataContext);
    else if (envelopes.has(key)) out[key] = input(model, v, projection, dataContext || ["data","create","createMany","update","updateMany"].includes(key));
    else if (!dataContext && v && typeof v === "object" && !Array.isArray(v) && "mode" in v) {
      const { mode, ...filter } = v as Record<string, unknown>;
      if (mode !== "insensitive" && mode !== "default") throw new Error("SQLITE_STRING_MODE_UNSUPPORTED");
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
  const activeTx = new AsyncLocalStorage<Record<string, unknown>>();
  const extended = native.$extends({ query: { $allOperations: async ({ model, args, query, operation }): Promise<unknown> => {
    return serialized(queueKey, async () => {
      if (!model) return normalizeSqliteRawResult(await query(args));
      await native.$connect();
      const patched = resolveSpecialFilters(model, args, adapter) as Record<string, unknown>;
      const dataOperations=patched.data as Record<string,unknown>|undefined;
      const arithmetic=dataOperations ? Object.entries(dataOperations).filter(([field,v])=>models[model]!.decimals[field] && v && typeof v === "object" && ("multiply" in v || "divide" in v)) : [];
      const listPush=dataOperations && Object.entries(dataOperations).some(([key,v])=>models[model]!.lists[key] && v && typeof v === "object" && !Array.isArray(v) && "push" in v);
      if (!activeTx.getStore() && (arithmetic.length || listPush || operation === "createMany" && patched.skipDuplicates)) {
        return facade.$transaction(async tx => {
          const delegate=(tx as unknown as Record<string,Record<string,(args:unknown)=>Promise<unknown>>>)[model[0]!.toLowerCase()+model.slice(1)]!;
          return delegate[operation]!(patched);
        });
      }
      if (arithmetic.length) {
        if (!["update","updateMany"].includes(operation)) throw new Error("SQLITE_DECIMAL_ARITHMETIC_OPERATION");
        const delegate=(activeTx.getStore() as unknown as Record<string,{findMany(args:unknown):Promise<Record<string,unknown>[]>;update(args:unknown):Promise<unknown>}>)[model[0]!.toLowerCase()+model.slice(1)]!;
        const rows=await delegate.findMany({where:patched.where});
        if(operation==="update" && rows.length!==1) return query(input(model,patched) as typeof args);
        const results=[];
        for(const row of rows) {
          const data={...dataOperations};
          for(const [field,change] of arithmetic) {
            const op=change as {multiply?:unknown;divide?:unknown}, spec=models[model]!.decimals[field]!;
            const value=row[field] as Prisma.Decimal|null;
            const result=value===null ? null : op.multiply!==undefined ? value.mul(String(op.multiply)) : value.div(String(op.divide));
            if(result && !result.isFinite()) throw new Error("SQLITE_DECIMAL_NOT_FINITE");
            data[field]=result?.toDecimalPlaces(spec.scale,Prisma.Decimal.ROUND_HALF_UP)??null;
          }
          results.push(await delegate.update({...patched,where:{id:row.id},data}));
        }
        return operation==="updateMany" ? {count:results.length} : results[0];
      }
      if (operation === "aggregate" && patched._avg) {
        const averages=patched._avg as Record<string,boolean>;
        const decimalFields=Object.keys(averages).filter(field=>averages[field] && models[model]!.decimals[field]);
        if (decimalFields.length) {
          const plain=Object.fromEntries(Object.entries(averages).filter(([field])=>!decimalFields.includes(field)));
          const base=Object.fromEntries(Object.entries(patched).filter(([key])=>key!=="_avg"));
          if(Object.keys(plain).length) base._avg=plain;
          const helperCount=!Object.keys(base).some(key=>key.startsWith("_"));
          if(helperCount) base._count=true;
          const result=output(model,await query(input(model,base) as typeof args)) as Record<string,unknown>;
          const delegate=((activeTx.getStore() ?? native) as unknown as Record<string,{findMany(args:unknown):Promise<Record<string,unknown>[]>}>)[model[0]!.toLowerCase()+model.slice(1)]!;
          const selection={where:patched.where,orderBy:patched.orderBy,skip:patched.skip,take:patched.take,cursor:patched.cursor,select:Object.fromEntries(decimalFields.map(field=>[field,true]))};
          const rows=await delegate.findMany(activeTx.getStore() ? selection : input(model,selection));
          const avg={...(result._avg as object??{})};
          for(const field of decimalFields) {
            const spec=models[model]!.decimals[field]!, values=rows.map(row=>row[field]).filter(v=>v!=null);
            const total=values.reduce<bigint>((sum,v)=>sum+(typeof v==="bigint" ? v : toSqliteUnits(v,spec)),0n);
            Object.assign(avg,{[field]:values.length ? new Prisma.Decimal(total.toString()).div(values.length).div(new Prisma.Decimal(10).pow(spec.scale)) : null});
          }
          if(helperCount) delete result._count;
          return {...result,_avg:avg};
        }
      }
      if (operation === "createMany" && patched.skipDuplicates) {
        delete patched.skipDuplicates;
        const delegate = ((activeTx.getStore() ?? native) as unknown as Record<string, {create(args: unknown): Promise<unknown>}>)[model[0]!.toLowerCase()+model.slice(1)]!;
        let count = 0;
        for (const row of (Array.isArray(patched.data) ? patched.data : [patched.data])) {
          try { await delegate.create({data: activeTx.getStore() ? row : input(model, row)}); count++; }
          catch (error) { if ((error as {code?:string}).code !== "P2002") throw error; }
        }
        return {count};
      }
      if (operation === "updateMany" && patched.data && Object.entries(patched.data as Record<string,unknown>).some(([key,v]) => models[model]!.lists[key] && v && typeof v === "object" && !Array.isArray(v) && "push" in v)) {
        const delegate = ((activeTx.getStore() ?? extended) as unknown as Record<string, {findMany(args: unknown): Promise<{id:string}[]>; update(args:unknown):Promise<unknown>}>)[model[0]!.toLowerCase()+model.slice(1)]!;
        const rows = await delegate.findMany({where: patched.where, select:{id:true}});
        for (const row of rows) await delegate.update({where:{id:row.id},data:patched.data});
        return {count:rows.length};
      }
      const data = patched.data as Record<string, unknown> | undefined;
      if (data) for (const [field, spec] of Object.entries(models[model]!.lists)) {
        const change = data[field];
        if (change && typeof change === "object" && !Array.isArray(change) && "push" in change) {
          if (operation !== "update") throw new Error("SQLITE_LIST_PUSH_REQUIRES_UNIQUE_UPDATE");
          const where = patched.where as { id?: string };
          if (typeof where?.id !== "string") throw new Error("SQLITE_LIST_PUSH_REQUIRES_ID");
          const row = adapter.connection!.prepare('SELECT "'+spec.column+'" AS value FROM "'+models[model]!.table+'" WHERE id=?').get(where.id) as {value:string}|undefined;
          const additions = (change as {push:unknown}).push;
          data[field] = [...(row ? JSON.parse(row.value) : []), ...(Array.isArray(additions) ? additions : [additions])];
        }
      }
      return output(model, await query(input(model, patched) as typeof args));
    });
  } } });
  const facade = new Proxy(extended, {
    get(target, prop) {
      if (prop === "$transaction") return (work: unknown, options?: Record<string, unknown>) => serialized(queueKey, async () => {
        if (Array.isArray(work)) return (target.$transaction as unknown as (work: unknown, options: object) => Promise<unknown>)(work,{...options,isolationLevel:"Serializable"});
        if (typeof work !== "function") throw new Error("SQLITE_TRANSACTION_CALLBACK_REQUIRED");
        const current = activeTx.getStore();
        if (current) return work(current);
        const opts = { ...options };
        if (opts.isolationLevel) {
          if (!["ReadCommitted","RepeatableRead","Serializable"].includes(String(opts.isolationLevel))) throw new Error("SQLITE_ISOLATION_UNSUPPORTED");
          opts.isolationLevel = "Serializable";
        }
        return (target.$transaction as unknown as (work: unknown, options: Record<string,unknown>) => Promise<unknown>)((tx: Record<string, unknown>) => activeTx.run(tx, () => work(tx)), opts);
      });
      const value = Reflect.get(activeTx.getStore() ?? target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
  return facade;
}


function resolveSpecialFilters(model: string, value: unknown, adapter: DesktopSqliteAdapter, filterContext = false): unknown {
  if (Array.isArray(value)) return value.map(v => resolveSpecialFilters(model,v,adapter,filterContext));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Prisma.Decimal) return value;
  const meta = models[model]!, out: Record<string,unknown> = {};
  const extra: unknown[] = [];
  for (const [key,v] of Object.entries(value)) {
    const filter = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : null;
    if (filterContext && filter && Array.isArray(filter.path)) {
      if (!meta.columns[key] || filter.path.some(x => typeof x !== "string" || !/^[a-zA-Z0-9_]+$/.test(x))) throw new Error("SQLITE_JSON_PATH_UNSUPPORTED");
      const column = '"'+meta.columns[key]+'"', path = '$.' + filter.path.join('.');
      const terms: string[] = [], params: (string | number | null)[] = [];
      for (const [op, operand] of Object.entries(filter)) {
        if (op === "path") continue;
        if (op === "equals" && ["string", "number", "boolean"].includes(typeof operand)) {
          terms.push(`json_extract(${column},?) = ?`); params.push(path, typeof operand === "boolean" ? Number(operand) : operand as string | number);
        } else if (op === "array_contains" && Array.isArray(operand)) {
          terms.push(`json_type(${column},?)='array'`); params.push(path);
          for (const item of operand) {
            if (!["string", "number", "boolean"].includes(typeof item)) throw new Error("SQLITE_JSON_VALUE_UNSUPPORTED");
            terms.push(`EXISTS(SELECT 1 FROM json_each(${column},?) WHERE value=?)`); params.push(path, typeof item === "boolean" ? Number(item) : item);
          }
        } else throw new Error("SQLITE_JSON_FILTER_UNSUPPORTED");
      }
      if (!terms.length) throw new Error("SQLITE_JSON_FILTER_REQUIRED");
      const rows = adapter.connection!.prepare('SELECT id FROM "'+meta.table+'" WHERE '+terms.join(' AND ')).all(...params) as {id:string}[];
      extra.push({id:{in:rows.map(r=>r.id)}});
    } else if (filterContext && meta.lists[key] && filter && !('set' in filter) && !('push' in filter)) {
      const column = '"'+meta.columns[key]+'"', terms: string[] = [], params: (string | number)[] = [];
      for (const [op, operand] of Object.entries(filter)) {
        const values = op === "has" ? [operand] : operand;
        if (op === "isEmpty" && typeof operand === "boolean") { terms.push(`json_array_length(${column}) ${operand ? '=' : '>'} 0`); continue; }
        if (!["has", "hasSome", "hasEvery", "equals"].includes(op) || !Array.isArray(values)) throw new Error("SQLITE_LIST_FILTER_UNSUPPORTED");
        if (values.some(x => meta.lists[key]!.type === "Int" ? !Number.isSafeInteger(x) : typeof x !== "string")) throw new Error("SQLITE_LIST_VALUE_INVALID");
        if (op === "equals") { terms.push(`json(${column})=json(?)`); params.push(JSON.stringify(values)); }
        else { terms.push(values.length ? '('+values.map(() => `EXISTS(SELECT 1 FROM json_each(${column}) WHERE value=?)`).join(op === "hasSome" ? ' OR ' : ' AND ')+')' : op === "hasSome" ? '0' : '1'); params.push(...values as (string|number)[]); }
      }
      const rows = adapter.connection!.prepare('SELECT id FROM "'+meta.table+'" WHERE '+terms.join(' AND ')).all(...params) as {id:string}[];
      extra.push({id:{in:rows.map(r=>r.id)}});
    } else if (filterContext && filter?.mode === "insensitive" && "equals" in filter) {
      if (Object.keys(filter).some(k=>k!=="mode"&&k!=="equals") || typeof filter.equals !== "string" || !meta.columns[key]) throw new Error("SQLITE_INSENSITIVE_EQUALITY_UNSUPPORTED");
      const rows=adapter.connection!.prepare('SELECT id FROM "'+meta.table+'" WHERE lower("'+meta.columns[key]+'")=lower(?)').all(filter.equals) as {id:string}[];
      extra.push({id:{in:rows.map(r=>r.id)}});
    } else if (meta.relations[key]) out[key]=resolveSpecialFilters(meta.relations[key],v,adapter,filterContext);
    else if (envelopes.has(key) || key==="include" || key==="select") out[key]=resolveSpecialFilters(model,v,adapter,filterContext || key === "where" || key === "cursor" || key === "having");
    else out[key]=v;
  }
  if(extra.length) out.AND=[...(Array.isArray(out.AND)?out.AND:out.AND?[out.AND]:[]),...extra];
  return out;
}

