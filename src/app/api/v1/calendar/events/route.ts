import { api, json, readJson } from "@/server/api-handler";
import { saveCalendarEvent } from "@/modules/calendar/application/calendar-service";
export const POST = api({}, async ({ actor, req }) => json(await saveCalendarEvent(actor, await readJson(req)), 201));
