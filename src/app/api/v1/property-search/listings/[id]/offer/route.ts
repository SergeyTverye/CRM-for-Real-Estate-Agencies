import { api, readJson } from "@/server/api-handler";
import { listingToOffer } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => listingToOffer(actor,params.id,await readJson(req)));
