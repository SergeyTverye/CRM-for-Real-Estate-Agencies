import { api } from "@/server/api-handler";
import { globalSearch } from "@/modules/search/application/search-service";

export const GET = api({}, async ({ req, actor }) => globalSearch(actor, req.nextUrl.searchParams.get("q") ?? ""));
