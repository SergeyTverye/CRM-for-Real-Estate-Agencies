import { api } from "@/server/api-handler";
import { getSearchRun } from "@/modules/property-search/application/search-service";
export const GET = api<{id:string}>({}, async ({actor, params}) => getSearchRun(actor, params.id));
