import { api, readJson } from "@/server/api-handler";
import { getAiSettings, updateAiSettings } from "@/modules/ai/application/settings-service";
export const GET = api({ access: "manager" }, async ({ actor }) => getAiSettings(actor));
export const PUT = api({ access: "manager" }, async ({ actor, req }) => updateAiSettings(actor, await readJson(req)));
