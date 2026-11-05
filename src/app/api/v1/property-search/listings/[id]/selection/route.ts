import { api, readJson } from "@/server/api-handler";
import { setSelection } from "@/modules/property-search/application/listing-service";
export const POST = api<{id:string}>({}, async ({actor,req,params}) => setSelection(actor,params.id,await readJson(req)));
