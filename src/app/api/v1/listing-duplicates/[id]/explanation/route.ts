import { api, readJson } from "@/server/api-handler";
import { explainDuplicateGroup } from "@/modules/listing-duplicates/application/explanation-service";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => explainDuplicateGroup(actor, params.id, await readJson(req)));
