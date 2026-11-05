import { api, readJson } from "@/server/api-handler";
import { getCollection, updateCollection } from "@/modules/collections/application/collection-service";
export const GET = api<{id:string}>({}, async ({ actor, params }) => getCollection(actor, params.id));
export const PATCH = api<{id:string}>({}, async ({ actor, params, req }) => updateCollection(actor, params.id, await readJson(req)));
