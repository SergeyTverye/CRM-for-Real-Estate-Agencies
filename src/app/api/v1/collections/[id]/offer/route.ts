import { api, readJson } from "@/server/api-handler";
import { collectionToOffer } from "@/modules/collections/application/collection-service";
export const POST = api<{id:string}>({}, async ({ actor, params, req }) => collectionToOffer(actor, params.id, await readJson(req)));
