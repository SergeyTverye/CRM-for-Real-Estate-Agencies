import { api, readJson } from "@/server/api-handler";
import { bulkSearchAction } from "@/modules/property-search/application/bulk-service";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => bulkSearchAction(actor, params.id, await readJson(req)));
