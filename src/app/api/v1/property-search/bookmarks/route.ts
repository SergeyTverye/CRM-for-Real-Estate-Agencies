import { api } from "@/server/api-handler";
import { listBookmarks } from "@/modules/property-search/application/listing-service";
export const GET = api({}, async ({actor}) => listBookmarks(actor));
