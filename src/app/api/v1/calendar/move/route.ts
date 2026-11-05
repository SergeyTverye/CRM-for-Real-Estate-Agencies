import { api, readJson } from "@/server/api-handler";
import { moveCalendarSource } from "@/modules/calendar/application/calendar-service";
export const POST = api({}, async ({ actor, req }) => moveCalendarSource(actor, await readJson(req)));
