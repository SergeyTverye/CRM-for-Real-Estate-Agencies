import path from "node:path";
import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import type { CredentialStore } from "@/modules/desktop-backup/domain/settings";
import { CredentialNotFoundError, EncryptedFileCredentialStore, WindowsDpapiProtector } from "@/modules/desktop-backup/infrastructure/credential-store";
import { getConfig, type AppConfig } from "@/shared/config/env";
import { ForbiddenError, InfrastructureError, ValidationError } from "@/shared/errors";

const ref = "00000000-0000-4000-8000-000000000006";
const inputSchema = z.object({ apiKey: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/),
  folder: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
type Credentials = z.infer<typeof inputSchema>;
function localStore(config: AppConfig): CredentialStore | undefined {
  if (config.CRM_DEPLOYMENT_MODE !== "desktop" || !process.env.DESKTOP_DATA_DIR || !path.isAbsolute(process.env.DESKTOP_DATA_DIR)) return;
  return new EncryptedFileCredentialStore(path.join(process.env.DESKTOP_DATA_DIR, "ai-credentials"), new WindowsDpapiProtector());
}
/** No caching: server and worker see a replacement on their next composition. */
export class AiCredentialsService {
  constructor(private readonly config: AppConfig, private readonly store?: CredentialStore) {}
  async resolve(): Promise<{ credentials: Credentials | null; source: "environment" | "local" | "none"; unavailable: boolean }> {
    if (this.config.YANDEX_CLOUD_API_KEY) return { credentials: { apiKey: this.config.YANDEX_CLOUD_API_KEY, folder: this.config.YANDEX_CLOUD_FOLDER }, source: "environment", unavailable: false };
    if (!this.store) return { credentials: null, source: "none", unavailable: false };
    if (!this.store.available) return { credentials: null, source: "none", unavailable: true };
    try {
      const parsed = inputSchema.safeParse(await this.store.get(ref));
      return { credentials: parsed.success ? parsed.data : null, source: parsed.success ? "local" : "none", unavailable: !parsed.success };
    } catch (error) {
      return { credentials: null, source: "none", unavailable: !(error instanceof CredentialNotFoundError) && (error as NodeJS.ErrnoException)?.code !== "ENOENT" };
    }
  }
  private manager(actor: Actor) { if (actor.role !== "manager") throw new ForbiddenError(); }
  async status(actor: Actor): Promise<{ configured: boolean; source: "environment" | "local" | "none"; editable: boolean; status: "configured" | "missing" | "unavailable" }> {
    this.manager(actor);
    const resolved = await this.resolve();
    return { configured: !!resolved.credentials, source: resolved.source, editable: !!this.store?.available,
      status: resolved.unavailable ? "unavailable" : resolved.credentials ? "configured" : "missing" };
  }
  async replace(actor: Actor, input: unknown) {
    this.manager(actor);
    // Do not propagate Zod issues/input or adapter exceptions into logs/audit.
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Проверьте ключ API и каталог Яндекс AI");
    if (!this.store?.available) throw new InfrastructureError("Защищённое хранилище Яндекс AI недоступно");
    try { await this.store.put(ref, parsed.data); }
    catch { throw new InfrastructureError("Не удалось сохранить подключение Яндекс AI"); }
    return this.status(actor);
  }
  async remove(actor: Actor) {
    this.manager(actor);
    if (!this.store?.available) throw new InfrastructureError("Защищённое хранилище Яндекс AI недоступно");
    try { await this.store.delete(ref); }
    catch { throw new InfrastructureError("Не удалось удалить подключение Яндекс AI"); }
    return this.status(actor);
  }
}
export function aiCredentialsService(config = getConfig()) { return new AiCredentialsService(config, localStore(config)); }
