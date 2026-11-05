import { api, json, readJson } from "@/server/api-handler";
import { listCalendar, quickCreateCalendarSource } from "@/modules/calendar/application/calendar-service";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api({}, async ({ actor, req }) => ({ items: await listCalendar(actor, searchParamsToObject(req.nextUrl.searchParams)) }));
export const POST = api({}, async ({ actor, req }) => json(await quickCreateCalendarSource(actor, await readJson(req)), 201));
