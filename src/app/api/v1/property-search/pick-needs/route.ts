import { api } from "@/server/api-handler";
import { pickSearchNeeds } from "@/modules/property-search/queries/picker-queries";

export const GET = api({}, async ({ req, actor }) => pickSearchNeeds(actor, Object.fromEntries(req.nextUrl.searchParams)));
