import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import { parse, resolve, relative, win32 } from "node:path";
const localRoots = new Set<string>();
export function assertLocalSqliteLocation(directory: string) {
  const cloudRoots = [process.env.OneDrive,process.env.OneDriveConsumer,process.env.OneDriveCommercial].filter((s):s is string=>Boolean(s));
  for(const cloud of cloudRoots) {
    const diff=relative(resolve(cloud),directory);
    if(diff===""||(!diff.startsWith("..")&&!parse(diff).root))throw new Error("SQLITE_CLOUD_PATH_FORBIDDEN");
  }
  const root=process.platform==="win32" ? parse(directory).root.replaceAll("/","\\").toUpperCase() : parse(directory).root;
  if(process.platform==="win32" && !/^[A-Z]:[\\/]$/.test(root))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
  if(localRoots.has(root))return;
  if(process.platform==="win32"){
     const script="$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'; [Console]::Write([int]([System.IO.DriveInfo]::new('"+root+"').DriveType))";
     const systemRoot=process.env.SystemRoot??"C:\\Windows";
     if(!/^[a-z]:[\\/]/i.test(systemRoot) || systemRoot.includes("\0"))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
     let kind: string;
     try {
       kind=execFileSync(win32.join(systemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{
         encoding:"utf8",windowsHide:true,timeout:15000,maxBuffer:1024,
         cwd:systemRoot,env:{SystemRoot:systemRoot,WINDIR:systemRoot,PSModulePath:"",NODE_ENV:process.env.NODE_ENV??"production"},stdio:["ignore","pipe","pipe"],
       }).trim();
     } catch(error) {
       const safe=new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
       if(error && typeof error==="object" && "code" in error && error.code==="ETIMEDOUT")Object.assign(safe,{code:"ETIMEDOUT"});
       throw safe;
     }
    if(!["2","3","6"].includes(kind))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
  } else {
    const type=Number(statfsSync(directory).type);
    if([0x6969,0x517b,0xff534d42,0x65735546].includes(type))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
  }
  localRoots.add(root);
}

