import { api, readJson } from "@/server/api-handler";
import { updateItem, collectionItemAction } from "@/modules/collections/application/collection-service";
export const PATCH = api<{id:string;itemId:string}>({}, async ({ actor, params, req }) => updateItem(actor, params.id, params.itemId, await readJson(req)));
export const POST = api<{id:string;itemId:string}>({}, async ({ actor, params, req }) => collectionItemAction(actor, params.id, params.itemId, await readJson(req)));
