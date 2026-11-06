import { api, readJson } from "@/server/api-handler";
import { settingsHttp } from "@/modules/desktop-backup/application/settings-http";
import { getBackupSettingsService } from "@/modules/desktop-backup/infrastructure/settings-runtime";
export const runtime = "nodejs";
export const GET = api({ access: "manager" }, async ({ actor }) =>
  settingsHttp(() => getBackupSettingsService().get(actor)));
export const PUT = api({ access: "manager" }, async ({ actor, req }) => {
  const input = await readJson(req);
  return settingsHttp(() => getBackupSettingsService().update(actor, input));
});
