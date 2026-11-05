import { api } from "@/server/api-handler";
import { listSelections } from "@/modules/property-search/application/listing-service";
import { parseInput,zUuid } from "@/shared/validation";
export const GET = api({}, async ({actor,req}) => listSelections(actor,parseInput(zUuid,req.nextUrl.searchParams.get("needId"))));
