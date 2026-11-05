import { api } from "@/server/api-handler";
import { searchParamsToObject } from "@/shared/validation";
import { aggregatePlanner } from "@/modules/calendar/application/planner-service";
export const GET = api({}, async ({ actor, req }) => aggregatePlanner(actor, searchParamsToObject(req.nextUrl.searchParams)));
