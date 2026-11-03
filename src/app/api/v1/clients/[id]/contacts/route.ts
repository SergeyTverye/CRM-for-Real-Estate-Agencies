import { api, json, readJson } from "@/server/api-handler";
import { addClientContact } from "@/modules/clients/application/client-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => json(await addClientContact(actor, params.id, await readJson(req)), 201));
