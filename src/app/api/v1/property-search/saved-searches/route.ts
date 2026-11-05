import { api, readJson } from "@/server/api-handler";
import { listSavedSearches,saveSearch } from "@/modules/property-search/application/listing-service";
export const GET = api({}, async ({actor}) => listSavedSearches(actor));
export const POST = api({}, async ({actor,req}) => saveSearch(actor,await readJson(req)));
