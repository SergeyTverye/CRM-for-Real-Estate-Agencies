import pg from "pg";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { existsSync, readFileSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma } from "../../src/generated/prisma/client";
import compatibility from "../../prisma/sqlite/compatibility.json";
import { toSqliteUnits } from "../../src/shared/db/sqlite-money";
import { applySqliteMigrations, removeNewSqlite } from "./database-lifecycle";
import { sqliteFilePath } from "../../src/shared/db/sqlite-adapter";

interface TransferField {name:string;dbName:string|null;type:string;kind:"scalar"|"object";isList:boolean;relationFromFields?:string[]}
interface TransferModel {name:string;dbName:string;fields:TransferField[]}
function transferModels():TransferModel[] {
  const schema=readFileSync("prisma/schema.prisma","utf8");
  if(createHash("sha256").update(schema).digest("hex")!==compatibility.sourceSha256) throw new Error("SQLITE_SCHEMA_MAPPING_OUTDATED");
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([,name,body])=>({
    name:name!,dbName:body!.match(/@@map\("([^"]+)"\)/)![1]!,
    fields:[...body!.matchAll(/^[ \t]+(\w+)[ \t]+(\w+)(\[\]|\?)?[ \t]*([^\r\n]*)/gm)].map(([,field,type,suffix,attrs])=>({
      name:field!,dbName:attrs!.match(/@map\("([^"]+)"\)/)?.[1]??null,type:type!,
      kind:Object.hasOwn(compatibility.models,type!) ? "object" as const : "scalar" as const,isList:suffix==="[]",
      relationFromFields:attrs!.match(/fields:\s*\[([^\]]+)\]/)?.[1]?.split(',').map(s=>s.trim()),
    })),
  }));
}
const models=transferModels();
const TransferDecimal=Prisma.Decimal.clone({precision:80});
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
const confidential = /рекламные[ _-]*объекты.*работа/i;
export interface TransferOptions { sourceUrl: string; targetFile: string; sourceStorage: string; targetStorage: string }
export interface TransferReport { status: "preflight" | "complete" | "failed"; entities: Record<string,{source:number;target:number}>; financial: Record<string,{source:string;target:string}>; files:number; incompatibilities:{entity:string;field?:string;code:string}[] }
export class TransferError extends Error { constructor(readonly report: TransferReport) { super("PG_SQLITE_TRANSFER_FAILED"); } }
async function checksum(file: string) { const hash=createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
async function safeFile(root: string, key: string) {
  if (!/^[a-z0-9][a-z0-9/_-]{8,200}$/.test(key) || key.includes("..")) throw new Error("STORAGE_KEY_INVALID");
  const file=path.resolve(root,key), relative=path.relative(root,file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("STORAGE_ESCAPE");
  let current=root;
  for (const part of relative.split(path.sep)) { current=path.join(current,part); if ((await lstat(current)).isSymbolicLink()) throw new Error("STORAGE_LINK_FORBIDDEN"); }
  if (await realpath(file) !== file) throw new Error("STORAGE_PHYSICAL_PATH_CHANGED");
  return file;
}
function conversion(model: typeof models[number], row: Record<string,unknown>) {
  const meta = compatibility.models[model.name as keyof typeof compatibility.models];
  return model.fields.filter(f=>f.kind!=="object").map(field=>{
    const column=field.dbName??field.name, value=row[column];
    if (value === undefined) throw new Error("SOURCE_COLUMN_MISSING");
    if (value === null) return null;
    if (field.type === "Decimal") return toSqliteUnits(value,(meta.decimals as Record<string,{precision:number;scale:number}>)[field.name]!);
    if (field.type === "DateTime") { const date=value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(+date)) throw new Error("DATE_INVALID"); return +date; }
    if (field.type === "Json") return String(value);
    if (field.isList) return JSON.stringify(value);
    if (field.type === "Boolean") return Number(value);
    if (["String","Int","BigInt","Float"].includes(field.type)) return value as string | number | bigint;
    throw new Error("SOURCE_TYPE_UNSUPPORTED");
  });
}
function orderedModels() {
  const pending=new Set(models), ordered:typeof models[number][]=[];
  while(pending.size) {
    const next=[...pending].find(m=>m.fields.filter(f=>f.kind==="object" && f.relationFromFields?.length && f.type!==m.name).every(f=>!([...pending].some(p=>p.name===f.type))));
    if(!next) { ordered.push(...pending); break; }
    ordered.push(next); pending.delete(next);
  }
  return ordered;
}
export async function migratePgToSqlite(options: TransferOptions): Promise<TransferReport> {
  const report: TransferReport={status:"preflight",entities:{},financial:{},files:0,incompatibilities:[]};
  const target=sqliteFilePath("file:"+path.resolve(options.targetFile));
  const sourceRoot=await realpath(path.resolve(options.sourceStorage)), targetRoot=path.resolve(options.targetStorage);
  if (existsSync(target) || existsSync(targetRoot)) throw new Error("TRANSFER_TARGET_MUST_BE_NEW");
  if (targetRoot.toLowerCase().startsWith(sourceRoot.toLowerCase()+path.sep) || sourceRoot.toLowerCase().startsWith(targetRoot.toLowerCase()+path.sep) || targetRoot.toLowerCase()===sourceRoot.toLowerCase()) throw new Error("STORAGE_ROOTS_OVERLAP");
  const source=new pg.Client({connectionString:options.sourceUrl});
  const rows=new Map<string,Record<string,unknown>[]>(), converted=new Map<string,ReturnType<typeof conversion>[]>();
  let dest:Database.Database|undefined, created=false, filesCreated=false, phase="preflight", currentEntity="schema";
  try {
    await source.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables=await source.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const expected=new Set(models.map(m=>m.dbName??m.name));
    for (const {table_name} of tables.rows) if(table_name!=="_prisma_migrations" && !expected.has(table_name)) report.incompatibilities.push({entity:table_name,code:"UNMAPPED_TABLE"});
    const columns=await source.query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
    for(const column of columns.rows) {
      const model=models.find(m=>m.dbName===column.table_name);
      if(model && !model.fields.some(f=>f.kind!=="object" && (f.dbName??f.name)===column.column_name)) report.incompatibilities.push({entity:model.name,field:column.column_name,code:"UNMAPPED_COLUMN"});
    }
    for(const model of orderedModels()) {
      currentEntity=model.name;
      const fields=model.fields.filter(f=>f.kind!=="object");
      const result=await source.query(`SELECT ${fields.map(f=>f.type==="Json" ? `${quote(f.dbName??f.name)}::text AS ${quote(f.dbName??f.name)}` : quote(f.dbName??f.name)).join(',')} FROM ${quote(model.dbName??model.name)}`);
      rows.set(model.name,result.rows); report.entities[model.name]={source:result.rowCount??0,target:0};
      const values:ReturnType<typeof conversion>[]=[];
      for(const row of result.rows) {
        if ([row.original_name,row.original_filename,row.file_name].some(v=>typeof v==="string"&&confidential.test(v))) report.incompatibilities.push({entity:model.name,code:"CONFIDENTIAL_FILE_REFUSED"});
        try {values.push(conversion(model,row));} catch {report.incompatibilities.push({entity:model.name,code:"VALUE_NOT_REPRESENTABLE"});}
      }
      converted.set(model.name,values);
      for(const field of fields.filter(f=>f.type==="Decimal")) {
        const sum=result.rows.reduce((total,row)=>total.add(String(row[field.dbName??field.name]??0)),new TransferDecimal(0));
        report.financial[model.name+"."+field.name]={source:sum.toString(),target:"0"};
      }
    }
    if(report.incompatibilities.length) throw new TransferError(report);
    closeSync(openSync(target,"wx")); created=true; phase="database"; applySqliteMigrations(target); dest=new Database(target); dest.defaultSafeIntegers(true); dest.pragma("foreign_keys=ON");
    dest.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON");
    for(const model of orderedModels()) {
      currentEntity=model.name;
      const fields=model.fields.filter(f=>f.kind!=="object"), table=quote(model.dbName??model.name);
      const statement=dest.prepare(`INSERT INTO ${table} (${fields.map(f=>quote(f.dbName??f.name)).join(',')}) VALUES (${fields.map(()=>'?').join(',')})`);
      for(const values of converted.get(model.name)!) statement.run(...values);
      report.entities[model.name]!.target=Number((dest.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:bigint}).n);
      if(report.entities[model.name]!.source!==report.entities[model.name]!.target) throw new Error("COUNT_MISMATCH");
      const meta=compatibility.models[model.name as keyof typeof compatibility.models];
      for(const field of fields.filter(f=>f.type==="Decimal")) {
        const spec=(meta.decimals as Record<string,{precision:number;scale:number}>)[field.name]!;
        const values=dest.prepare(`SELECT ${quote(field.dbName??field.name)} AS value FROM ${table}`).all() as {value:bigint|null}[];
        const sum=values.reduce((total,row)=>total.add(String(row.value??0)),new TransferDecimal(0)).div(new TransferDecimal(10).pow(spec.scale));
        const check=report.financial[model.name+"."+field.name]!; check.target=sum.toString();
        if(check.source!==check.target) throw new Error("FINANCIAL_MISMATCH");
      }
    }
    if((dest.pragma("foreign_key_check") as unknown[]).length) throw new Error("RELATION_MISMATCH");
    phase="storage"; currentEntity="files";
    await mkdir(targetRoot,{recursive:false}); filesCreated=true;
    const copyTree=async (relative="") => {
      for(const entry of await readdir(path.join(sourceRoot,relative),{withFileTypes:true})) {
        if(confidential.test(entry.name) || entry.isSymbolicLink()) throw new Error("STORAGE_ENTRY_REFUSED");
        const key=path.join(relative,entry.name), from=path.join(sourceRoot,key), to=path.join(targetRoot,key);
        if(entry.isDirectory()) {await mkdir(to); await copyTree(key);}
        else if(entry.isFile()) {await copyFile(from,to,constants.COPYFILE_EXCL); if(await checksum(from)!==await checksum(to)) throw new Error("FILE_COPY_MISMATCH"); report.files++;}
        else throw new Error("STORAGE_ENTRY_UNSUPPORTED");
      }
    };
    await copyTree();
    for(const name of ["Document","DocumentTemplateVersion"]) for(const row of rows.get(name)!) if(typeof row.storage_key==="string") {
      const from=await safeFile(sourceRoot,row.storage_key), to=await safeFile(targetRoot,row.storage_key);
      const hash=await checksum(from);
      if(typeof row.checksum==="string" && row.checksum!==hash || await checksum(to)!==hash) throw new Error("DOCUMENT_CHECKSUM_MISMATCH");
      if(name==="Document" && Number((await lstat(to)).size)!==Number(row.file_size)) throw new Error("DOCUMENT_SIZE_MISMATCH");
    }
    dest.exec("COMMIT");
    if(dest.pragma("integrity_check",{simple:true})!=="ok") throw new Error("SQLITE_INTEGRITY_FAILED");
    dest.close(); dest=undefined;
    report.status="complete"; return report;
  } catch(error) {
    if(dest) {try{dest.exec("ROLLBACK");}catch{} dest.close();}
    if(created) removeNewSqlite(target);
    if(filesCreated) await rm(targetRoot,{recursive:true,force:true});
    report.status="failed";
    if(!report.incompatibilities.length) {
      const code=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : String((error as {code?:string}).code??"VERIFICATION_FAILED").replace(/[^A-Z0-9_]/g,"");
      report.incompatibilities.push({entity:currentEntity,code:phase.toUpperCase()+"_"+code});
    }
    throw error instanceof TransferError ? error : new TransferError(report);
  } finally {try{await source.query("ROLLBACK");}catch{} await source.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [targetFile,sourceStorage,targetStorage]=process.argv.slice(2);
  if(!process.env.SOURCE_DATABASE_URL || !targetFile || !sourceStorage || !targetStorage) throw new Error("Use SOURCE_DATABASE_URL and arguments: new.db source-storage new-storage");
  migratePgToSqlite({sourceUrl:process.env.SOURCE_DATABASE_URL,targetFile,sourceStorage,targetStorage})
    .then(report=>console.log(JSON.stringify(report,null,2)))
    .catch(error=>{console.error(JSON.stringify(error instanceof TransferError ? error.report : {status:"failed",code:"TRANSFER_PREFLIGHT_FAILED"}));process.exitCode=1;});
}
