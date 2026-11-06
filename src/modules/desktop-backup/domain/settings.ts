import { z } from "zod";
export const retentionSettingsSchema = z.object({ keep: z.number().int().min(2).max(1000), maxAgeDays: z.number().int().min(1).max(3650), maxBytes: z.number().int().min(1024 ** 2).max(Number.MAX_SAFE_INTEGER) }).strict();
const common = { id: z.uuid(), enabled: z.boolean(), retention: retentionSettingsSchema.optional() };
const prefix = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/);
const directory = z.string().min(1).max(1024).refine(p => !/[\x00-\x1f]/.test(p), "Invalid directory");
const local = z.object({ ...common, kind: z.literal("local"), directory }).strict();
const removable = z.object({ ...common, kind: z.literal("removable"), directory }).strict();
const yandex = z.object({ ...common, kind: z.literal("yandex_s3"), bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/), prefix, endpoint: z.literal("https://storage.yandexcloud.net"), region: z.literal("ru-central1") }).strict();
const mailru = z.object({ ...common, kind: z.literal("mailru_webdav"), email: z.email().max(254), prefix, endpoint: z.literal("https://webdav.cloud.mail.ru"), partBytes: z.number().int().min(1024 * 1024).max(128 * 1024 ** 2), useMove: z.boolean() }).strict();
export const destinationConfigSchema = z.discriminatedUnion("kind", [local, removable, yandex, mailru]);
const secret = z.string().min(1).max(4096);
export const destinationInputSchema = z.discriminatedUnion("kind", [
  local, removable,
  yandex.extend({ credentials: z.object({ accessKeyId: secret, secretAccessKey: secret }).strict().optional(), clearCredentials: z.boolean().optional() }),
  mailru.extend({ applicationPassword: secret.optional(), clearCredentials: z.boolean().optional() }),
]);
export const scheduleSchema = z.object({
  enabled: z.boolean(), timeZone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  frequency: z.enum(["daily", "weekly"]), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6), onClose: z.boolean(), beforeUpdate: z.boolean(),
}).strict();
export const settingsUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime().nullable(), destinations: z.array(destinationInputSchema).max(16),
  schedule: scheduleSchema,
  retention: retentionSettingsSchema,
}).strict();
const storedDestinationSchema = z.object({ config: destinationConfigSchema, secretRef: z.uuid().optional() }).strict();
export const settingsStateSchema = z.object({
  version: z.literal(1), updatedAt: z.iso.datetime().nullable(), updatedBy: z.uuid().nullable(),
  destinations: z.array(storedDestinationSchema).max(16), schedule: scheduleSchema,
  retention: settingsUpdateSchema.shape.retention,
}).strict();
export type DestinationConfig = z.infer<typeof destinationConfigSchema>;
export type BackupSettingsState = z.infer<typeof settingsStateSchema>;
export interface SettingsPrincipal { userId: string; role: string }
export interface CredentialStore {
  readonly protection: "server-aes-256-gcm" | "windows-dpapi-current-user";
  readonly available: boolean;
  put(ref: string, value: Record<string, string>): Promise<void>;
  get(ref: string): Promise<Record<string, string>>;
  delete(ref: string): Promise<void>;
}
export interface SettingsRepository {
  read(): Promise<BackupSettingsState>;
  transaction<T>(work: (state: BackupSettingsState) => Promise<{ state: BackupSettingsState; result: T }>): Promise<T>;
}
export const defaultSettings = (): BackupSettingsState => ({
  version: 1, updatedAt: null, updatedBy: null, destinations: [],
  schedule: { enabled: false, timeZone: "Asia/Novosibirsk", frequency: "daily", hour: 19, minute: 0, weekday: 1, onClose: false, beforeUpdate: true },
  retention: { keep: 7, maxAgeDays: 30, maxBytes: 20 * 1024 ** 3 },
});
