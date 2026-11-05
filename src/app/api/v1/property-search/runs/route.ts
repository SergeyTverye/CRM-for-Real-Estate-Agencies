import { api, readJson } from "@/server/api-handler";
import { enqueueSearch } from "@/modules/property-search/application/search-queue";
export const POST = api({}, async ({actor, req}) => enqueueSearch(actor, await readJson(req)));
