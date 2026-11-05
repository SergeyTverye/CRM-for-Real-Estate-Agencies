import { api, readJson } from "@/server/api-handler";
import { runSearch } from "@/modules/property-search/application/search-service";
export const POST = api({}, async ({actor, req}) => runSearch(actor, await readJson(req)));
