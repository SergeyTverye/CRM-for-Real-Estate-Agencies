import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const root=process.cwd();
const base='postgresql://crm:crm_test_password@127.0.0.1:55432/';
async function counts(name){const c=new pg.Client({connectionString:base+name});await c.connect();const tables=(await c.query("select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by tablename")).rows;const result={};for(const {tablename:t} of tables)result[t]=Number((await c.query('select count(*) as n from "'+t+'"')).rows[0].n);await c.end();return result;}
function deploy(name){execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:base+name},stdio:'pipe'});}
const before=await counts('crm_v241_copy');deploy('crm_v241_copy');const after=await counts('crm_v241_copy');deploy('crm_v31_empty');const empty=await counts('crm_v31_empty');const changed=Object.keys(before).filter(t=>before[t]!==after[t]);const report={time:new Date().toISOString(),sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),before,after,changed,emptyTables:Object.keys(empty).length,newTables:Object.keys(after).filter(t=>!(t in before))};writeFileSync(root+'/docs/operations/evidence-v31/migrations.json',JSON.stringify(report,null,2));console.log(JSON.stringify({tablesBefore:Object.keys(before).length,tablesAfter:Object.keys(after).length,emptyTables:report.emptyTables,changed}));if(changed.length)process.exitCode=1;
