import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertRuntimeEntries, runtimeEntries, runtimeBuildOptions } from './runtime-entries.mjs';
const require = createRequire(import.meta.url);
const root = process.cwd();
const app = path.join(root,'src-tauri/resources/app');
const versions = JSON.parse(await readFile('scripts/desktop/desktop-versions.json','utf8'));
const dist = '.next-desktop';
function run(exe,args,options={}) {
  // Windows PowerShell 5.1 inherits PowerShell 7 module paths from a pwsh runner and then fails to load its own
  // Microsoft.PowerShell.Utility/Archive modules (Get-FileHash, Expand-Archive). Give it a clean module path.
  const env = { ...process.env };
  if (/^powershell(\.exe)?$/i.test(path.basename(exe))) delete env.PSModulePath;
  const r = spawnSync(exe,args,{cwd:root,env,stdio:'inherit',windowsHide:true,...options});
  if (r.error || r.status !== 0) throw Error('BUILD_STEP_FAILED:' + path.basename(exe));
}
function npm(args,cwd=root) { run(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',['/d','/s','/c','npm ' + args.join(' ')],{cwd}); }
const forbidden = name => /^(?:\.env(?:\..*)?|\.git|private-data)$/i.test(name) || /\.(?:db|sqlite|crmbackup|dump)(?:-(?:wal|shm))?$/i.test(name);
async function copySafe(from,to) {
  await cp(from,to,{recursive:true,dereference:true,filter:src => !forbidden(path.basename(src)) && !['data','backups'].includes(path.relative(from,src).split(path.sep)[0]) && !src.includes(path.sep+'private-imports'+path.sep)});
}
async function rejectPrivateFiles(dir) {
  for (const item of await readdir(dir,{withFileTypes:true})) {
    if (forbidden(item.name)) throw Error('PRIVATE_RESOURCE_REJECTED');
    const file = path.join(dir,item.name);
    if ((await lstat(file)).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
    if (item.isDirectory()) await rejectPrivateFiles(file);
  }
}
if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== versions.node) throw Error('USE_PINNED_WINDOWS_NODE_' + versions.node);
if (existsSync(app)) throw Error('RESOURCE_DIRECTORY_ALREADY_EXISTS_USE_CLEAN_CI_CHECKOUT');
assertRuntimeEntries({ tracked: process.env.CI === 'true' });
await mkdir(app,{recursive:true});
run(process.execPath,['scripts/desktop/create-icon.mjs']);
Object.assign(process.env,{CRM_BUILD_TARGET:'desktop',CRM_DEPLOYMENT_MODE:'desktop',NEXT_DIST_DIR:dist,NEXT_TELEMETRY_DISABLED:'1'});
npm(['run','build']);
await copySafe(path.join(root,dist,'standalone'),app);
await copySafe(path.join(root,dist,'static'),path.join(app,dist,'static'));
if (existsSync('public')) await copySafe('public',path.join(app,'public'));
await copySafe('import-profiles',path.join(app,'import-profiles'));
await copySafe('prisma/sqlite',path.join(app,'prisma/sqlite'));
await copySafe('src/generated/prisma-sqlite',path.join(app,'generated/sqlite'));
await cp('prisma/sqlite.config.ts',path.join(app,'prisma/sqlite.config.ts'));
// Production install only; no workspace, env or dev packages are copied.
// Explicit vendor tarball is an existing public dependency, never a root glob.
await cp('package.json',path.join(app,'package.json'));
await cp('package-lock.json',path.join(app,'package-lock.json'));
await mkdir(path.join(app,'vendor'),{recursive:true});
await cp('vendor/real-estate-scrapper-2.1.0.tgz',path.join(app,'vendor/real-estate-scrapper-2.1.0.tgz'));
npm(['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],app);
npm(['rebuild','better-sqlite3'],app);
await rm(path.join(app,'vendor'),{recursive:true,force:true});
const entries = runtimeEntries;
for (const [out,input] of Object.entries(entries)) await build({...runtimeBuildOptions,entryPoints:[input],outfile:path.join(app,out)});
for (const file of ['supervisor.mjs','graceful.cjs']) await cp(path.join('scripts/desktop/runtime',file),path.join(app,file));
// Download only the official, fixed-version Node zip and verify both release manifest and pinned digest.
const zipName = 'node-v' + versions.node + '-win-x64.zip';
const url = 'https://nodejs.org/dist/v' + versions.node + '/';
const response = await fetch(url+'SHASUMS256.txt'); if (!response.ok) throw Error('NODE_SHASUMS_DOWNLOAD');
const sums = await response.text();
const expected = sums.split(/\r?\n/).find(l=>l.trim().endsWith(' '+zipName))?.trim().split(/\s+/)[0];
if (!expected || expected !== versions.nodeZipSha256) throw Error('NODE_RELEASE_CHECKSUM_CHANGED');
const download = await fetch(url+zipName); if (!download.ok) throw Error('NODE_DOWNLOAD');
const bytes = Buffer.from(await download.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('NODE_ZIP_CHECKSUM');
const stage = path.join(root,'src-tauri/resources/node-download');
await mkdir(stage,{recursive:true}); const zip = path.join(stage,zipName); await writeFile(zip,bytes);
run('powershell.exe',['-NoProfile','-NonInteractive','-Command','& { param($archive,$target) Expand-Archive -LiteralPath $archive -DestinationPath $target } '+'"'+zip.replaceAll('"','""')+'" "'+stage.replaceAll('"','""')+'"']);
await mkdir(path.join(app,'node'),{recursive:true});
const unpacked = path.join(stage,'node-v'+versions.node+'-win-x64');
for (const file of ['node.exe','LICENSE']) await cp(path.join(unpacked,file),path.join(app,'node',file));
await writeFile(path.join(app,'node/SHASUMS256.txt'),sums);
run('powershell.exe',['-NoProfile','-NonInteractive','-File','scripts/desktop/copy-vc-runtime.ps1','-Destination',path.join(app,'node')]);
await rm(stage,{recursive:true,force:true});
run(path.join(app,'node/node.exe'),['-e',"const D=require('better-sqlite3');const db=new D(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)process.exit(1);db.close();require('@node-rs/argon2');require('sharp');"],{cwd:app});
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(app,'chromium');
run(process.execPath,[path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),'install','chromium']);
const { chromium } = require('playwright-core');
const executable = chromium.executablePath();
if (!executable.startsWith(app + path.sep) || !existsSync(executable)) throw Error('CHROMIUM_NOT_BUNDLED');
let resourceBytes=0;
async function measure(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await measure(file);else resourceBytes+=(await lstat(file)).size;}}
await measure(app);
const version = JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8')).version;
await writeFile(path.join(app,'desktop-manifest.json'),JSON.stringify({version,resourceBytes,node:versions.node,chromium:path.relative(app,executable),initEntry:entries['init-db.cjs'],backupEntry:entries['workers/backup.cjs']},null,2));
// Generate from the exact lock used by npm ci. The standalone trace and native
// rebuilds are not a complete Arborist install tree; npm sbom otherwise rejects
// absent development/platform packages. The lock inventory includes production
// optional variants for other platforms, which is declared in RUNTIMES.md.
const sbom = spawnSync(process.env.ComSpec ?? 'cmd.exe',['/d','/s','/c','npm sbom --omit=dev --sbom-format=cyclonedx --package-lock-only'],{cwd:app,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
if (sbom.error || sbom.status !== 0) {
  const code = sbom.stderr?.match(/npm (?:ERR!|error) code ([A-Z0-9_]+)/)?.[1] ?? 'UNKNOWN';
  throw Error('SBOM_FAILED_' + code);
}
const inventory = JSON.parse(sbom.stdout);
if (inventory.bomFormat !== 'CycloneDX' || !Array.isArray(inventory.components) || !inventory.components.length) throw Error('SBOM_INVALID');
for (const name of ['next','better-sqlite3','@node-rs/argon2','@prisma/client']) {
  const installed = JSON.parse(await readFile(path.join(app,'node_modules',name,'package.json'),'utf8'));
  const slash = name.lastIndexOf('/');
  if (!inventory.components.some(c => (c.name === name || c.name === name.slice(slash + 1) && (slash < 0 || c.group === name.slice(0,slash))) && c.version === installed.version)) throw Error('SBOM_COMPONENT_MISSING');
}
await writeFile(path.join(app,'sbom.cdx.json'),JSON.stringify(inventory,null,2));
await writeFile(path.join(app,'RUNTIMES.md'),`Node.js ${versions.node} x64 (node/LICENSE); Chromium (chromium/*/LICENSE*); WebView2 Evergreen Offline Installer (Microsoft); Tauri 2 (MIT/Apache-2.0); app-local MSVC CRT (Microsoft Visual Studio Distributable Code, node/MSVC-RUNTIME.json).\nProduction npm dependency/license inventory: sbom.cdx.json, generated from the exact npm ci lockfile with dev dependencies omitted. Optional platform variants listed by the lock may not all be installed on Windows. Next, SQLite, Argon2 and Prisma versions are checked against the installed bundle. No host Node/npm required.\n`);
await rejectPrivateFiles(app);
run(process.execPath,['scripts/security/confidential-guard.mjs','--artifacts','--artifact','src-tauri/resources/app']);
console.log('DESKTOP_BUNDLE_READY');
