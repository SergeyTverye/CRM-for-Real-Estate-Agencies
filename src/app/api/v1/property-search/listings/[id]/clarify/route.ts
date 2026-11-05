import { api, readJson } from "@/server/api-handler";
import { clarifyListing } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => clarifyListing(actor,params.id,await readJson(req)));
