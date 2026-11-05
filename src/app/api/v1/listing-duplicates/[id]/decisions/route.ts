import { api, readJson } from "@/server/api-handler";
import { decideDuplicateGroup } from "@/modules/listing-duplicates/application/duplicate-service";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => decideDuplicateGroup(actor, params.id, await readJson(req)));
