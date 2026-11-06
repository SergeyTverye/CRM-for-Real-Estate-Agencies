import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const stage=path.resolve('data/desktop-runtime-check');
await mkdir(stage,{recursive:true});
const entries=['src/worker/notifications-worker.ts','src/worker/property-search-worker.ts','scripts/desktop/runtime/backup-worker.ts','scripts/desktop/init-db.ts','scripts/desktop/runtime/upgrade.ts'];
for(const [i,input] of entries.entries()) {
  const file=path.join(stage,i+'.cjs');
  await build({entryPoints:[input],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node24',packages:'external',define:{'import.meta.url':'__crmModuleUrl'},banner:{js:"const __crmModuleUrl = require('node:url').pathToFileURL(__filename).href;"}});
}
const env={...process.env,NODE_ENV:'test',CRM_DEPLOYMENT_MODE:'desktop',DATABASE_URL:'file:'+path.join(stage,randomUUID()+'.db').replaceAll('\\','/'),DESKTOP_DATA_DIR:path.join(stage,'data'),FILE_STORAGE_PATH:path.join(stage,'files'),CRM_DESKTOP_SUPERVISED_UPGRADE:'1'};
const init=spawnSync(process.execPath,[path.join(stage,'3.cjs'),'--initialize'],{env,windowsHide:true,stdio:'pipe'});
if(init.status!==0)throw Error('BUNDLED_INIT_FAILED');
const load=spawnSync(process.execPath,['-e',"require("+JSON.stringify(path.join(stage,'4.cjs'))+");require("+JSON.stringify(path.join(stage,'2.cjs'))+");"],{env,windowsHide:true,stdio:'pipe'});
if(load.status!==0)throw Error('BUNDLED_MODULE_LOAD_FAILED');
console.log('WORKER_BUNDLES_AND_INIT_PASS');
