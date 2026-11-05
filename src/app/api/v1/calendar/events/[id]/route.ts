import { api, readJson } from "@/server/api-handler";
import { archiveCalendarEvent, getCalendarEvent, saveCalendarEvent } from "@/modules/calendar/application/calendar-service";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => getCalendarEvent(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ actor, req, params }) => saveCalendarEvent(actor, await readJson(req), params.id));
export const DELETE = api<{ id: string }>({}, async ({ actor, req, params }) => archiveCalendarEvent(actor, params.id, await readJson(req)));
