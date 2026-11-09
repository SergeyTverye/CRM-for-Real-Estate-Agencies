import path from "node:path";
import { BackupError } from "../domain/contracts";
import { BackupSettingsService } from "../application/settings-service";
import { JsonSettingsRepository } from "./settings-repository";
import { EncryptedFileCredentialStore, ServerAesProtector, WindowsDpapiProtector } from "./credential-store";
let singleton: BackupSettingsService | undefined;
export function getBackupSettingsService() {
  if (singleton) return singleton;
  const mode = process.env.CRM_DEPLOYMENT_MODE ?? "server";
  if (mode !== "server" && mode !== "desktop") throw new BackupError("DEPLOYMENT_MODE_INVALID");
  const root = process.env.BACKUP_SETTINGS_DIR ?? (mode === "desktop"
    ? path.join(process.env.DESKTOP_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "RealEstateCRM", "data"), "backup-settings")
    : path.resolve("data", "backup-settings"));
  if (!path.isAbsolute(root)) throw new BackupError("SETTINGS_DIRECTORY_ABSOLUTE");
  const protector = mode === "desktop" ? new WindowsDpapiProtector() : new ServerAesProtector(() => process.env.BACKUP_SETTINGS_MASTER_KEY);
  singleton = new BackupSettingsService(new JsonSettingsRepository(root), new EncryptedFileCredentialStore(path.join(root, "credentials"), protector));
  return singleton;
}
