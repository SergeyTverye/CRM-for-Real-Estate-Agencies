import { randomUUID } from "node:crypto";
import path from "node:path";
import { BackupError } from "../domain/contracts";
import { destinationConfigSchema, settingsUpdateSchema, type BackupSettingsState, type CredentialStore, type SettingsPrincipal, type SettingsRepository } from "../domain/settings";
export class BackupSettingsService {
  constructor(private readonly repository: SettingsRepository, private readonly credentials: CredentialStore) {}
  private manager(actor: SettingsPrincipal) { if (actor.role !== "manager") throw new BackupError("SETTINGS_FORBIDDEN"); }
  private dto(state: BackupSettingsState) {
    return { updatedAt: state.updatedAt, destinations: state.destinations.map(d => ({ ...d.config, credentialsConfigured: !!d.secretRef })), schedule: state.schedule, retention: state.retention, secretStorage: { protection: this.credentials.protection, available: this.credentials.available } };
  }
  async get(actor: SettingsPrincipal) { this.manager(actor); return this.dto(await this.repository.read()); }
  async update(actor: SettingsPrincipal, raw: unknown) {
    this.manager(actor);
    const parsed = settingsUpdateSchema.safeParse(raw); if (!parsed.success) throw new BackupError("SETTINGS_VALIDATION");
    const input = parsed.data;
    if (new Set(input.destinations.map(d => d.id)).size !== input.destinations.length) throw new BackupError("SETTINGS_VALIDATION");
    const created: string[] = []; const retired: string[] = [];
    let committed = false;
    try {
      const result = await this.repository.transaction(async before => {
        if (before.updatedAt !== input.expectedUpdatedAt) throw new BackupError("SETTINGS_STALE");
        const destinations: BackupSettingsState["destinations"] = [];
        for (const item of input.destinations) {
          const { credentials: s3, applicationPassword, clearCredentials, ...publicFields } = item as typeof item & { credentials?: { accessKeyId: string; secretAccessKey: string }; applicationPassword?: string; clearCredentials?: boolean };
          const config = destinationConfigSchema.parse(publicFields);
          if ((config.kind === "local" || config.kind === "removable") && !path.isAbsolute(config.directory)) throw new BackupError("SETTINGS_DIRECTORY_ABSOLUTE");
          const previous = before.destinations.find(d => d.config.id === config.id);
          if (previous && previous.config.kind !== config.kind) throw new BackupError("SETTINGS_KIND_IMMUTABLE");
          let secretRef = previous?.secretRef;
          const cloud = config.kind === "yandex_s3" || config.kind === "mailru_webdav";
          const supplied = config.kind === "yandex_s3" ? s3 : config.kind === "mailru_webdav" && applicationPassword !== undefined ? { applicationPassword } : undefined;
          if (clearCredentials && supplied) throw new BackupError("SETTINGS_VALIDATION");
          if (supplied) {
            const ref = randomUUID(); await this.credentials.put(ref, supplied); created.push(ref); secretRef = ref;
          } else if (clearCredentials) secretRef = undefined;
          if (cloud && config.enabled && !secretRef) throw new BackupError("SETTINGS_CREDENTIALS_REQUIRED");
          destinations.push({ config, ...(secretRef ? { secretRef } : {}) });
        }
        for (const prior of before.destinations) if (prior.secretRef && !destinations.some(d => d.secretRef === prior.secretRef)) retired.push(prior.secretRef);
        const state: BackupSettingsState = { version: 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(before.updatedAt ?? "1970-01-01T00:00:00.000Z") + 1)).toISOString(), updatedBy: actor.userId, destinations, schedule: input.schedule, retention: input.retention };
        return { state, result: this.dto(state) };
      });
      committed = true;
      for (const ref of retired) { try { await this.credentials.delete(ref); } catch {} }
      return result;
    } catch (e) {
      if (!committed) {
        let active: Set<string> | undefined;
        try { active = new Set((await this.repository.read()).destinations.flatMap(d => d.secretRef ? [d.secretRef] : [])); } catch {}
        if (active) for (const ref of created) if (!active.has(ref)) { try { await this.credentials.delete(ref); } catch {} }
      }
      if (e instanceof BackupError) throw e; throw new BackupError("SETTINGS_STORAGE_FAILED");
    }
  }
}
