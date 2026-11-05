import { api } from "@/server/api-handler";
import { searchParamsToObject } from "@/shared/validation";
import { pickCalendarLinks } from "@/modules/calendar/application/calendar-service";
export const GET = api({}, async ({ actor, req }) => ({ items: await pickCalendarLinks(actor, searchParamsToObject(req.nextUrl.searchParams)) }));
