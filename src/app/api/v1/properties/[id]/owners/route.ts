import { api, json, readJson } from "@/server/api-handler";
import { addPropertyOwner } from "@/modules/properties/application/property-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => json(await addPropertyOwner(actor, params.id, await readJson(req)), 201));
