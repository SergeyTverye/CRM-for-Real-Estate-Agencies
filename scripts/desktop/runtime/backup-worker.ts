import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { ReplicationQueue } from "../../../src/modules/desktop-backup/application/replication-queue";
import { JsonSettingsRepository } from "../../../src/modules/desktop-backup/infrastructure/settings-repository";
import { EncryptedFileCredentialStore, WindowsDpapiProtector } from "../../../src/modules/desktop-backup/infrastructure/credential-store";
import { LocalDir } from "../../../src/modules/desktop-backup/infrastructure/local-destination";
import { YandexS3 } from "../../../src/modules/desktop-backup/infrastructure/yandex-s3";
import { MailruWebDav } from "../../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import type { BackupDestination } from "../../../src/modules/desktop-backup/domain/contracts";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());
/** One supervised owner; recovers the persisted queue on restart/network return.
 * Never auto-uploads local DPAPI safety snapshots; portable backups must explicitly enqueue. */
export async function pumpDesktopBackups(signal: AbortSignal) {
  const root = process.env.DESKTOP_DATA_DIR;
  if (!root || process.env.CRM_DEPLOYMENT_MODE !== "desktop") throw Error("DESKTOP_REQUIRED");
  const settingsRoot=path.join(root,"backup-settings");
  const state=await new JsonSettingsRepository(settingsRoot).read();
  const secrets=new EncryptedFileCredentialStore(path.join(settingsRoot,"credentials"),new WindowsDpapiProtector());
  const destinations: BackupDestination[]=[];
  for(const item of state.destinations) {
    if(!item.config.enabled) continue;
    const config=item.config;
    try {
      if(config.kind==="local" || config.kind==="removable") destinations.push(new LocalDir(config.id,config.directory,config.kind==="removable"));
      else {
        if(!item.secretRef) continue;
        const credential=await secrets.get(item.secretRef);
        if(config.kind==="yandex_s3" && credential.accessKeyId && credential.secretAccessKey) destinations.push(new YandexS3({...config,workRoot:path.join(root,"backup-transfer"),credentials:{accessKeyId:credential.accessKeyId,secretAccessKey:credential.secretAccessKey}}));
        if(config.kind==="mailru_webdav" && credential.applicationPassword) destinations.push(new MailruWebDav({...config,workRoot:path.join(root,"backup-transfer"),applicationPassword:credential.applicationPassword}));
      }
    } catch { console.error("BACKUP_DESTINATION_UNAVAILABLE"); }
  }
  const queue=new ReplicationQueue(path.join(root,"backup-queue"),destinations);
  try { await queue.pump(Date.now(),signal); }
  finally { for(const destination of destinations) if(destination instanceof YandexS3) destination.client.destroy(); }
}
async function main() {
  while(!controller.signal.aborted) {
    try { await pumpDesktopBackups(controller.signal); } catch { console.error("BACKUP_QUEUE_RETRY"); }
    if(!controller.signal.aborted) await setTimeout(30000,undefined,{signal:controller.signal}).catch(()=>undefined);
  }
}
if(process.env.CRM_DESKTOP_WORKER === "1") void main();
