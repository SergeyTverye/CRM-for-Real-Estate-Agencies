import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "../domain/contracts";
import { defaultSettings, settingsStateSchema, type BackupSettingsState, type SettingsRepository } from "../domain/settings";
import { atomicJson, protectedDir, regularFile } from "./fs";
export class JsonSettingsRepository implements SettingsRepository {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
  private get file() { return path.join(this.root, "destinations.v1.json"); }
  async read() {
    try {
      await regularFile(this.file);
      if ((await stat(this.file)).size > 128 * 1024) throw new BackupError("SETTINGS_SIZE_LIMIT");
      return settingsStateSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings(); throw new BackupError("SETTINGS_STORAGE_INVALID"); }
  }
  transaction<T>(work: (state: BackupSettingsState) => Promise<{ state: BackupSettingsState; result: T }>): Promise<T> {
    const execute = async () => { await protectedDir(this.root); const result = await work(await this.read()); await atomicJson(this.file, settingsStateSchema.parse(result.state)); return result.result; };
    const result = this.tail.then(execute, execute); this.tail = result.catch(() => {}); return result;
  }
}
