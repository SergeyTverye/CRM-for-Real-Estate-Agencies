import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import { parse, resolve, relative } from "node:path";
const localRoots = new Set<string>();
/** Real drive check, including mapped Windows network drives, before WAL. */
export function assertLocalSqliteLocation(directory: string) {
  const cloudRoots = [process.env.OneDrive,process.env.OneDriveConsumer,process.env.OneDriveCommercial].filter((s):s is string=>Boolean(s));
  for(const cloud of cloudRoots) {
    const diff=relative(resolve(cloud),directory);
    if(diff===""||(!diff.startsWith("..")&&!parse(diff).root))throw new Error("SQLITE_CLOUD_PATH_FORBIDDEN");
  }
  const root=parse(directory).root;
  if(localRoots.has(root))return;
  if(process.platform==="win32"){
    const drive=root.slice(0,2);
    if(!/^[a-z]:$/i.test(drive))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
    const script="(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='"+drive+"'\").DriveType";
    const kind=execFileSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true,timeout:15000}).trim();
    if(!["2","3","6"].includes(kind))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
  } else {
    const type=Number(statfsSync(directory).type);
    if([0x6969,0x517b,0xff534d42,0x65735546].includes(type))throw new Error("SQLITE_LOCAL_VOLUME_REQUIRED");
  }
  localRoots.add(root);
}

