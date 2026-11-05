import { api } from "@/server/api-handler";
import { deleteBookmark } from "@/modules/property-search/application/listing-service";
export const DELETE = api<{id:string}>({}, async ({actor,params}) => deleteBookmark(actor,params.id));
