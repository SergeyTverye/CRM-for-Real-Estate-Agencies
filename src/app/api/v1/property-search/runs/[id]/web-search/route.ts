import { api } from "@/server/api-handler";
import { manualWebSearch } from "@/modules/property-search/application/search-service";
export const POST = api<{id:string}>({}, async ({actor, params}) => manualWebSearch(actor, params.id));
