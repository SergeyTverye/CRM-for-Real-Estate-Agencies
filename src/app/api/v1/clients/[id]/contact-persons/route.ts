import { api, json, readJson } from "@/server/api-handler";
import { addContactPerson } from "@/modules/clients/application/client-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => json(await addContactPerson(actor, params.id, await readJson(req)), 201));
