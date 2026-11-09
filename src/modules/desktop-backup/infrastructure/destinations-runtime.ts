import path from "node:path";
import { BackupError, type BackupDestination } from "../domain/contracts";
import { JsonSettingsRepository } from "./settings-repository";
import { EncryptedFileCredentialStore, ServerAesProtector, WindowsDpapiProtector } from "./credential-store";
import { LocalDir } from "./local-destination";
import { YandexS3 } from "./yandex-s3";
import { MailruWebDav } from "./mailru-webdav";

function unavailableDestination(id: string): BackupDestination {
  const fail = async (): Promise<never> => { throw new BackupError("DESTINATION_UNAVAILABLE"); };
  return { id, put: fail, get: fail, list: fail, verify: fail, delete: fail };
}

export function backupRuntimeRoot() {
  return process.env.BACKUP_SETTINGS_DIR ?? (process.env.CRM_DEPLOYMENT_MODE === "desktop" ? path.join(process.env.DESKTOP_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "RealEstateCRM", "data"), "backup-settings") : path.resolve("data", "backup-settings"));
}
export function runtimeCredentialStore() {
  const protector = process.env.CRM_DEPLOYMENT_MODE === "desktop" ? new WindowsDpapiProtector() : new ServerAesProtector(() => process.env.BACKUP_SETTINGS_MASTER_KEY);
  return new EncryptedFileCredentialStore(path.join(backupRuntimeRoot(), "credentials"), protector);
}
export async function withBackupDestinations<T>(work: (destinations: BackupDestination[]) => Promise<T>, onlyId?: string) {
  const state = await new JsonSettingsRepository(backupRuntimeRoot()).read();
  const destinations: BackupDestination[] = [];
  try {
    for (const item of state.destinations) {
      const c = item.config;
      if (!c.enabled || onlyId && c.id !== onlyId) continue;
      try {
      if (c.kind === "local" || c.kind === "removable") destinations.push(new LocalDir(c.id, c.directory, c.kind === "removable"));
      else {
        if (!item.secretRef) throw new BackupError("CREDENTIALS_REQUIRED");
        const secret = await runtimeCredentialStore().get(item.secretRef);
        const workRoot = path.join(backupRuntimeRoot(), "transfer");
        if (c.kind === "yandex_s3") destinations.push(new YandexS3({ ...c, workRoot, credentials: { accessKeyId: secret.accessKeyId!, secretAccessKey: secret.secretAccessKey! } }));
        else destinations.push(new MailruWebDav({ ...c, workRoot, applicationPassword: secret.applicationPassword! }));
      }
      } catch {
        if (onlyId) throw new BackupError("DESTINATION_UNAVAILABLE");
        destinations.push(unavailableDestination(c.id));
      }
    }
    if (onlyId && !destinations.length) throw new BackupError("DESTINATION_UNAVAILABLE");
    return await work(destinations);
  } finally { for (const d of destinations) if (d instanceof YandexS3) d.client.destroy(); }
}
