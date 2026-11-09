import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
async function main() {
const fixture=JSON.parse(await readFile("data/sqlite-stage2-http-fixture.json","utf8"));
const origin="http://127.0.0.1:3511";
const portProbe=net.createServer();await new Promise<void>((resolve,reject)=>{portProbe.once("error",reject);portProbe.listen(3511,"127.0.0.1",()=>portProbe.close(()=>resolve()));});
const originalConfig=JSON.parse(await readFile("tsconfig.json","utf8"));
const log=createWriteStream("data/sqlite-stage2-http-server.log");
const child=spawn(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","-p","3511"],{windowsHide:true,env:{...process.env,NODE_ENV:"development",CRM_DEPLOYMENT_MODE:"desktop",CRM_DESKTOP_PORT:"3511",NEXT_DIST_DIR:".next-3511",DATABASE_URL:"file:"+fixture.targetFile,FILE_STORAGE_PATH:fixture.targetStorage,AI_ENABLED:"false",SCRAPER_ENABLED:"false",LOG_LEVEL:"silent",COOKIE_SECURE:"false"},stdio:["ignore","pipe","pipe"]});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
try {
  let ready=false;const deadline=Date.now()+180000;
  while(Date.now()<deadline) {
    if(child.exitCode!==null) throw new Error("SMOKE_SERVER_EXITED");
    try {const r=await fetch(origin+"/api/health/ready",{signal:AbortSignal.timeout(10000)});if(r.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,"SMOKE_READINESS_FAILED");
  const denied=await fetch(origin+"/api/v1/clients");assert.equal(denied.status,401);
  const login=await fetch(origin+"/api/v1/auth/login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({login:fixture.login,password:"TestPassw0rd!"})});assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie")!.split(';')[0]!;
  const clients=await fetch(origin+"/api/v1/clients",{headers:{cookie}});assert.equal(clients.status,200);assert.ok((await clients.text()).includes(fixture.clientId));
  const download=await fetch(origin+`/api/v1/documents/${fixture.documentId}/download`,{headers:{cookie}});assert.equal(download.status,200);assert.ok((await download.arrayBuffer()).byteLength>100);
  const foreignOrigin=await fetch(origin+"/api/v1/clients",{headers:{cookie,origin:"http://example.invalid"}});assert.equal(foreignOrigin.status,403);
  const page=await fetch(origin+"/clients",{headers:{cookie}});assert.equal(page.status,200);
  console.log("HTTP_SMOKE_PASS: readiness, login, authenticated API, file, page, Origin rejection");
} finally {
  if(child.exitCode===null && child.pid) {
    if(process.platform==="win32") execFileSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});else child.kill("SIGTERM");
  }
  log.end();
  const text=await readFile("tsconfig.json","utf8"), current=JSON.parse(text);
  const added=(current.include as string[]).filter(v=>v.startsWith(".next-3511/") && !originalConfig.include.includes(v));
  let cleaned=text;
  for(const value of added) cleaned=cleaned.replace(new RegExp('^[ \t]*"'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'",?\r?\n','m'),"");
  if(cleaned!==text) {cleaned=cleaned.replace(/,(\s*\])/g,'$1');await writeFile("tsconfig.json",cleaned);}
}

}
main().catch(()=>{console.error("HTTP_SMOKE_FAILED");process.exitCode=1;});
