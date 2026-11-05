import { api } from "@/server/api-handler";
import { getGroupsForListings } from "@/modules/listing-duplicates/application/duplicate-service";
export const GET = api({}, async ({ actor, req }) => ({ groups: await getGroupsForListings(actor, (req.nextUrl.searchParams.get("listingIds") ?? "").split(",").filter(Boolean)) }));
