import { api, readJson } from "@/server/api-handler";
import { snoozeNotification } from "@/modules/notifications/application/notification-service";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => snoozeNotification(actor, params.id, await readJson(req)));
