import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import metadata from "../../prisma/sqlite/compatibility.json";
const B=String.fromCharCode(96);
const code=(s:string)=>B+s.replaceAll(B,"'").replaceAll("|","\\|").replace(/\s+/g," ")+B;
function walk(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?(d.name==="generated"?[]:walk(join(dir,d.name))):/\.(?:ts|mts)$/.test(d.name)?[join(dir,d.name)]:[]);}
const out=[
"# Аудит PostgreSQL → SQLite, этап 1",
"",
"ТЗ v3.2.1 §2/§4, DT-05/06/17. Только исходный код и синтетические тесты. Рабочие БД, пользовательские файлы и Excel не исследовались.",
"","Источник: prisma/schema.prisma, SHA-256 "+metadata.sourceSha256+". Фактически "+Object.keys(metadata.models).length+" модели; число 87 в ТЗ — историческая оценка, модели не удалялись.",
"",
"## Принятые решения",
"",
"| Место | PG-конструкция | SQLite-решение |",
"|---|---|---|",
"| schema: UUID | @db.Uuid + gen_random_uuid() | TEXT + клиентский uuid(); перенос сохраняет исходные ID |",
"| schema: DateTime | timestamptz(3), date | UTC epoch milliseconds (unixepoch-ms); date-only — полночь UTC; APP_TIMEZONE при выводе |",
"| schema: Decimal(p,s) | numeric, точная десятичная арифметика | BigInt / INTEGER ×10^s; facade ↔ Prisma.Decimal; CHECK typeof/range, без Number |",
"| schema: String[]/Int[] | scalar lists | Json-массив + CHECK/валидация; set и чтение работают; push/has фильтры этап 2, fail closed |",
"| schema: Json | JSONB | SQLite JSONB/JSON1 через Prisma; специальный accessRoles array_contains → IDs в исходном RBAC-предикате |",
"| schema: enum | PostgreSQL enum types | В текущей схеме enum-блоков нет; codebook — String + перенесённые CHECK |",
"| db/client.ts | PrismaPg | server по умолчанию; только CRM_DEPLOYMENT_MODE=desktop выбирает отдельный клиент |",
"| db/dialect.ts | advisory / row locks | очередь всего callback + BEGIN IMMEDIATE + busy_timeout=10000; select/lock сохраняет строки |",
"| db/sqlite-adapter.ts | ILIKE/mode insensitive | Unicode like()/lower() на реальном соединении; equals → exact lower() candidate IDs; не contains |",
"| calendar/planner-service | AT TIME ZONE, to_char, lateral VALUES | crm_local_day/crm_date_at_zone + JSON1 unpivot; SQL агрегат без загрузки 1500 Task |",
"| reports/reactivation-query | make_interval | целые epoch milliseconds, gapDays ×86400000 |",
"| property-search/queries/results-query | LATERAL, md5/string_agg, JSON ->>, NULLS LAST | Явный SQLITE_MODULE_NOT_PORTED; полная выдача/экспорт этап 2 |",
"| PrismaAiLedger | ReadCommitted после advisory lock | Serializable + сериализация полной read/check/reserve транзакции; 12 попыток, бюджет 2.50 → 2 резерва по 1.00 |",
"| results-query | RepeatableRead | PG остаётся прежним; SQLite выдача закрыта до отдельной реализации |",
"",
"Decimal проверен по установленному adapter 7.10.1: mapArg(decimal) вызывает Number.parseFloat. Поэтому его нативный Decimal не используется. Проверяемые верхние значения: 99999999999999.99; 0.10+0.20=0.30; точность AI до 10^-6.",
"",
"## Поля scalar lists / Decimal",
"",
"| Модель.поле | PG | SQLite |",
"|---|---|---|",
];
for(const[model,meta]of Object.entries(metadata.models)){
 for(const[field,spec]of Object.entries(meta.lists))out.push("| "+code(model+"."+field)+" | "+spec.type+"[] | Json array ("+spec.column+") |");
 for(const[field,spec]of Object.entries(meta.decimals))out.push("| "+code(model+"."+field)+" | numeric("+spec.precision+","+spec.scale+") | BigInt scaled ×10^"+spec.scale+" ("+spec.column+") |");
}
out.push("","## Остальные native types и defaults по моделям","","| Модель | Конструкции PG / поля | SQLite |","|---|---|---|");
const schema=readFileSync("prisma/schema.prisma","utf8");
for(const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)){
 const lines=match[2]!.split("\n").filter(l=>/@db\.|dbgenerated/.test(l));
 if(lines.length)out.push("| "+code(match[1]!)+" | "+lines.map(l=>code(l.trim())).join("<br>")+" | UUID→TEXT, timestamptz/date→epoch, Decimal→scaled INTEGER; map/FK/unique/index сохранены |");
}
out.push("","## Все raw SQL: production и operational scripts","","Параметры остаются bind values. В server все обёртки возвращают исходный Prisma.Sql. Scripts demo/perf остаются PG-инструментами, в desktop supervisor не входят.","","| Файл:строка | Запрос / назначение | SQLite |","|---|---|---|");
for(const file of [...walk("src"),...walk("scripts")].sort()){
 if(file.replaceAll("\\","/")==="scripts/desktop/sqlite-audit.ts")continue;
 const source=readFileSync(file,"utf8"),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 function visit(node:ts.Node){
  const tagged=ts.isTaggedTemplateExpression(node)&&/\.\$(queryRaw|executeRaw)(Unsafe)?$/.test(node.tag.getText(ast));
  const call=ts.isCallExpression(node)&&/\.\$(queryRaw|executeRaw)(Unsafe)?$/.test(node.expression.getText(ast));
  if(tagged||call){
   const raw=node.getText(ast),line=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
   const solution=raw.includes("lockSql(")?"lockSql: BEGIN IMMEDIATE / сериализованный select":raw.includes("plannerSql(")?"plannerSql: UTC/IANA + JSON1 + GROUP BY":raw.includes("reactivationSql(")?"reactivationSql: gap epoch":raw.includes("scalarSql(")?"scalarSql: удалить только ::uuid/int/bigint; остальное SQL совместимо":raw.includes("requirePostgresSql(")?"Этап 2, явный fail closed":file.startsWith("scripts")?"PG-only инструмент, вне desktop":"Совместимый SQL / проверить caller";
   out.push("| "+code(file.replaceAll("\\","/")+":"+line)+" | "+code(raw)+" | "+solution+" |");return;
  }
  ts.forEachChild(node,visit);
 }visit(ast);
}
out.push("","## ORM фильтры и изоляция: все места","","| Место | Конструкция | Решение |","|---|---|---|");
for(const file of walk("src")){
 const s=readFileSync(file,"utf8");
 s.split("\n").forEach((line,i)=>{
 if(/mode:\s*["']insensitive|has(?:Some|Every)?:|array_contains:|isolationLevel:/.test(line))
 out.push("| "+code(file.replaceAll("\\","/")+":"+(i+1))+" | "+code(line.trim())+" | "+(line.includes("array_contains")?(file.includes("scopes")?"accessRoles adapter, RBAC сохранён":"JSON source paths этап 2"):line.includes("isolationLevel")?"PG неизменён; SQLite Serializable":"Unicode like / exact lower кандидаты; list фильтры fail closed")+" |");
 });
}
out.push("","## Транзакции и изоляция","","Общий transaction(fn): timeout=30000, maxWait=10000; SQLite сериализует всю callback и все соседние операции до завершения. Prisma callback READ COMMITTED/REPEATABLE READ усиливается до Serializable. Server остаётся неизменным. Ниже все места вызовов, а не только SQL-lock sites.","","| Место | Вызов | SQLite |","|---|---|---|");
for(const file of walk("src")) {
 const text=readFileSync(file,"utf8");
 text.split("\n").forEach((line,i)=>{
  if(/\btransaction\s*[<(]|\.\$transaction\s*[<(]/.test(line))out.push("| "+code(file.replaceAll("\\","/")+":"+(i+1))+" | "+code(line.trim())+" | callback queue + BEGIN IMMEDIATE; неподдержанный batch отклоняется |");
 });
}
out.push("","## SQL-миграции: CHECK, unique, triggers/functions","","Отдельная baseline получена prisma migrate diff. 132 действующих CHECK перенесены с учётом DROP/ADD; reminder_offsets — INSERT/UPDATE triggers. Composite FK template/version и action/session добавлены вручную. ownership_share ≤1 преобразован в ≤10000. Все scaled integer поля имеют typeof/range CHECK. UUID defaults находятся в клиенте.","","| Миграция:строка | Конструкция | SQLite |","|---|---|---|");
for(const dir of readdirSync("prisma/migrations").sort()){
 if(dir==="migration_lock.toml")continue;
 const p="prisma/migrations/"+dir+"/migration.sql",s=readFileSync(p,"utf8");
 s.split("\n").forEach((line,i)=>{
 if(/ADD CONSTRAINT.*(?:check|CHECK)|^\s*CHECK|CREATE (?:UNIQUE INDEX|(?:OR REPLACE )?FUNCTION|(?:CONSTRAINT )?TRIGGER)/.test(line))
 out.push("| "+code(p+":"+(i+1))+" | "+code(line.trim())+" | "+(/FUNCTION|TRIGGER/.test(line)?"constraints.sql: SQLite trigger; без PL/pgSQL":/INDEX/.test(line)?"Prisma indexes + manual partial/singleton/expression indexes":"baseline CHECK; jsonb_typeof→json_type, btrim→trim, host regex→GLOB")+" |");
 });
}
out.push("","## Этап 2 и границы доказательства","","1. Полная property-search выдача/экспорт: LATERAL snapshot, revision digest, JSON/operators, сортировки и exact scaled raw DTO.","2. Полная поддержка scalar-list filters/push и JSON paths source.kind/source.ids при регенерации документов; неподдержанный запрос не должен терять фильтр.","3. PG→SQLite мигратор всех таблиц/шаблонов/документов, rollback staging, FK/count/checksum/финансовая сверка (DT-06 пока TODO).","4. Production offline запуск, packaging Node24/native addon, workers/supervisor, совместимость нескольких процессов, desktop backup/restore, clean install (DT-17 PARTIAL).","5. Полная SQLite regression всех модулей, в том числе import/export, шаблоны/PDF, notifications, поиск/AI-chat, все UI/API роли. Наличие модели и port lock не является PASS модуля.","6. _avg, multiply/divide Decimal и batch-array $transaction требуют отдельного API/доказательства; сейчас unsupported fail closed. Текущие production batch read calls переведены на callback.","7. Перед WAL прототип проверяет canonical path, UNC/cloud paths и mapped drive type; supervisor должен дополнить ACL и reparse/cloud-root detection. Tauri не развивался.","","Протокол и команды: [sqlite-core-prototype.md](sqlite-core-prototype.md). Архитектурное решение: [ADR 0010](../adr/0010-sqlite-desktop-backend.md).","");
mkdirSync("docs/desktop",{recursive:true});
writeFileSync("docs/desktop/sqlite-audit.md",out.join("\n")+"\n");
console.log("Audit rows: "+out.length);

