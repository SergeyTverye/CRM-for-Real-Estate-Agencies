import { api, readJson } from "@/server/api-handler";
import { getNotificationPreference, setNotificationPreference } from "@/modules/notifications/application/notification-service";
export const GET = api({}, async ({ actor }) => getNotificationPreference(actor));
export const PUT = api({}, async ({ actor, req }) => setNotificationPreference(actor, await readJson(req)));
