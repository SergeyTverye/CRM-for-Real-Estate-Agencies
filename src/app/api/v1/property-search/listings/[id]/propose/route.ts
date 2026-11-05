import { api, readJson } from "@/server/api-handler";
import { proposeListing } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => proposeListing(actor,params.id,await readJson(req)));
