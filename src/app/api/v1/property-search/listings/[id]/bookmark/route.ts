import { api, readJson } from "@/server/api-handler";
import { setBookmark } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => setBookmark(actor,params.id,await readJson(req)));
