import { api, readJson } from "@/server/api-handler";
import { deleteSavedSearch,saveSearch } from "@/modules/property-search/application/listing-service";
export const PATCH = api<{id:string}>({}, async ({actor,req,params}) => saveSearch(actor,await readJson(req),params.id));
export const DELETE = api<{id:string}>({}, async ({actor,params}) => deleteSavedSearch(actor,params.id));
