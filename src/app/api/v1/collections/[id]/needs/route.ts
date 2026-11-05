import { api, readJson } from "@/server/api-handler";
import { linkNeed } from "@/modules/collections/application/collection-service";
export const POST = api<{id:string}>({}, async ({ actor, params, req }) => linkNeed(actor, params.id, await readJson(req)));
