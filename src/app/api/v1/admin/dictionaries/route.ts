import { api, json, readJson } from "@/server/api-handler";
import { createDictionaryItem, listDictionaryItems } from "@/modules/dictionaries/application/dictionaries-service";

export const GET = api({ access: "manager" }, async ({ actor }) => ({ items: await listDictionaryItems(actor) }));
export const POST = api({ access: "manager" }, async ({ req, actor }) => json(await createDictionaryItem(actor, await readJson(req)), 201));
