import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRuntimeEntries, runtimeEntries, runtimeBuildOptions } from './runtime-entries.mjs';
assertRuntimeEntries();
const stage=path.resolve('src-tauri/target/runtime-check',randomUUID());
await mkdir(stage,{recursive:true});
for(const [output,input] of Object.entries(runtimeEntries)) {
  const file=path.join(stage,output);
  await build({...runtimeBuildOptions,entryPoints:[input],outfile:file});
}
const env={...process.env,NODE_ENV:'test',CRM_DEPLOYMENT_MODE:'desktop',CRM_DESKTOP_WORKER:'0',DATABASE_URL:'file:'+path.join(stage,randomUUID()+'.db').replaceAll('\\','/'),DESKTOP_DATA_DIR:path.join(stage,'data'),FILE_STORAGE_PATH:path.join(stage,'files'),CRM_DESKTOP_SUPERVISED_UPGRADE:'1'};
const init=spawnSync(process.execPath,[path.join(stage,'init-db.cjs'),'--initialize'],{env,windowsHide:true,stdio:'pipe',timeout:60000});
if(init.status!==0)throw Error('BUNDLED_INIT_FAILED');
const load=spawnSync(process.execPath,['-e',"require("+JSON.stringify(path.join(stage,'upgrade.cjs'))+");require("+JSON.stringify(path.join(stage,'workers/backup.cjs'))+");"],{env,windowsHide:true,stdio:'pipe',timeout:30000});
if(load.status!==0)throw Error('BUNDLED_MODULE_LOAD_FAILED');
console.log('WORKER_BUNDLES_AND_INIT_PASS');
