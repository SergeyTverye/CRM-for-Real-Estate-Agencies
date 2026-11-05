import { api, readJson } from "@/server/api-handler";
import { verifyListing } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => verifyListing(actor,params.id,await readJson(req)));
