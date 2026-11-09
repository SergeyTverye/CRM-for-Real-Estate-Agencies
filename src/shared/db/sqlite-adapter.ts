import { assertLocalSqliteLocation } from "./sqlite-location";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { SqlDriverAdapter } from "@prisma/driver-adapter-utils";
import type Database from "better-sqlite3";
import { isAbsolute, resolve, dirname, basename } from "node:path";
import { realpathSync, mkdirSync } from "node:fs";
import { localDateString, fromDateTimeLocalValue } from "@/shared/time";

export function sqliteFilePath(url: string): string {
  if (!url.startsWith("file:")) throw new Error("SQLITE_FILE_URL_REQUIRED");
  const raw = url.slice(5);
  if (!raw || raw.includes("?") || raw.includes("#") || raw.startsWith("//") || raw.startsWith("\\\\")) throw new Error("SQLITE_LOCAL_PATH_REQUIRED");
  const file = isAbsolute(raw) ? raw : resolve(raw);
  mkdirSync(dirname(file), { recursive: true });
  const physical = resolve(realpathSync(dirname(file)), basename(file));
  if (/\\\\|(?:^|[\\/])(OneDrive|Яндекс[ ._-]?Диск|YandexDisk|Cloud Mail|Облако Mail)/i.test(physical)) throw new Error("SQLITE_LOCAL_PATH_REQUIRED");
  assertLocalSqliteLocation(dirname(physical));
  return physical;
}
export function unicodeLike(pattern: string, value: string, escape = "\\"): number {
  const tokens: { kind: "many" | "one" | "literal"; char?: string }[] = [];
  const source = Array.from(pattern.toLowerCase());
  for (let i=0;i<source.length;i++) {
    const char=source[i]!;
    if(char===escape && i+1<source.length) tokens.push({kind:"literal",char:source[++i]!});
    else if(char==="%") { if(tokens.at(-1)?.kind!=="many")tokens.push({kind:"many"}); }
    else tokens.push(char==="_"?{kind:"one"}:{kind:"literal",char});
  }
  const text=Array.from(value.toLowerCase());
  let previous=new Uint8Array(text.length+1); previous[0]=1;
  for(const token of tokens){
    const next=new Uint8Array(text.length+1);
    if(token.kind==="many")next[0]=previous[0]!;
    for(let j=1;j<=text.length;j++) next[j]=token.kind==="many"?Number(Boolean(previous[j]||next[j-1])):Number(Boolean(previous[j-1])&&(token.kind==="one"||text[j-1]===token.char));
    previous=next;
  }
  return previous[text.length]!;
}
export const DESKTOP_SQLITE_PRAGMAS = [
  // Порядок важен: сначала режим журнала, затем остальные.
  "foreign_keys = ON",
  "busy_timeout = 10000",
  "journal_mode = WAL",
  // Безопасно в WAL и совместимо с Online Backup API (бекап читает страницы
  // через sqlite3_backup, отдельные соединения эти настройки не затрагивают).
  // synchronous=NORMAL в WAL теряет не более последней транзакции только при
  // сбое ОС/питания. локальный диск уже обязателен (sqlite-location).
  "synchronous = NORMAL",
  // 64 МБ page cache: горячие страницы Сегодня/Задач/Календаря остаются в памяти.
  "cache_size = -64000",
  // Мелкие temp-B-tree сортировок (ORDER BY на страницах списков) — в память.
  "temp_store = MEMORY",
  // До 256 МБ read-only mmap для файла БД. записи идут обычным путём.
  "mmap_size = 268435456",
] as const;

export class DesktopSqliteAdapter extends PrismaBetterSqlite3 {
  connection?: Database.Database;
  override async connect(): Promise<SqlDriverAdapter> {
    const adapter = await super.connect();
    const native = (adapter as unknown as { client?: Database.Database }).client;
    if (!native || typeof native.function !== "function") { await adapter.dispose(); throw new Error("SQLITE_ADAPTER_CONNECTION_CONTRACT"); }
    this.connection = native;
    for (const pragma of DESKTOP_SQLITE_PRAGMAS) native.pragma(pragma);
    native.function("lower", { deterministic: true }, v => v === null ? null : String(v).toLowerCase());
    native.function("like", { deterministic: true, varargs: true }, (pattern, value, escape) =>
      pattern === null || value === null ? null : unicodeLike(String(pattern), String(value), escape === undefined ? "\\" : String(escape)));
    native.function("crm_local_day", { deterministic: true }, (value, tz) => localDateString(new Date(Number(value)), String(tz)));
    native.function("crm_date_at_zone", { deterministic: true }, (value, tz) =>
      new Date(fromDateTimeLocalValue(new Date(Number(value)).toISOString().slice(0, 10) + "T00:00", String(tz))).getTime());
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolation => {
      const transaction = await start(isolation);
      try { native.exec("ROLLBACK; BEGIN IMMEDIATE"); return transaction; }
      catch (error) { await transaction.rollback(); throw error; }
    };
    return adapter;
  }
}

