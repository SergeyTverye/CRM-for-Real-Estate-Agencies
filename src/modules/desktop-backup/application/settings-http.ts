import { ForbiddenError, InfrastructureError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { BackupError } from "../domain/contracts";
export async function settingsHttp<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (e) {
    if (e instanceof BackupError) {
      if (e.code === "SETTINGS_FORBIDDEN") throw new ForbiddenError();
      if (e.code === "SETTINGS_STALE") throw new StaleUpdateError();
      if (["SETTINGS_VALIDATION", "SETTINGS_DIRECTORY_ABSOLUTE", "SETTINGS_KIND_IMMUTABLE", "SETTINGS_CREDENTIALS_REQUIRED"].includes(e.code)) throw new ValidationError(e.code === "SETTINGS_CREDENTIALS_REQUIRED" ? "Для включения направления укажите учётные данные" : "Проверьте настройки резервного копирования");
    }
    throw new InfrastructureError("Хранилище настроек резервного копирования недоступно");
  }
}
