import { api, readJson } from "@/server/api-handler";
import { transferToCatalog } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => transferToCatalog(actor,params.id,await readJson(req)));
