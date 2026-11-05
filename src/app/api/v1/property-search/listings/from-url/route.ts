import { api, readJson } from "@/server/api-handler";
import { createListingFromUrl } from "@/modules/property-search/application/manual-import-service";
export const POST = api({}, async ({ actor, req }) => createListingFromUrl(actor, await readJson(req), req.signal));
