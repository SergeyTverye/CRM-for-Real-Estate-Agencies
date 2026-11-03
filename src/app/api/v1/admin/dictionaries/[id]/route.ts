import { api, readJson } from "@/server/api-handler";
import { updateDictionaryItem } from "@/modules/dictionaries/application/dictionaries-service";

export const PATCH = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => updateDictionaryItem(actor, params.id, await readJson(req)));
