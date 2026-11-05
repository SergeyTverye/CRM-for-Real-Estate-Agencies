import { api } from "@/server/api-handler";
import { cancelSearch } from "@/modules/property-search/application/search-queue";
export const POST = api<{ id: string }>({}, async ({ actor, params }) => cancelSearch(actor, params.id));
