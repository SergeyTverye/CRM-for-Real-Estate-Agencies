import { api } from "@/server/api-handler";
import { exportSearchCsv } from "@/modules/property-search/application/search-service";
export const GET = api<{id:string}>({}, async ({actor, params}) => new Response(await exportSearchCsv(actor, params.id), {headers:{"content-type":"text/csv; charset=utf-8", "content-disposition":"attachment; filename=property-search.csv", "cache-control":"no-store"}}));
