import { api, readJson } from "@/server/api-handler";
import { changeNotification } from "@/modules/notifications/application/notification-service";
export const PATCH = api<{ id: string }>({}, async ({ actor, req, params }) => changeNotification(actor, params.id, await readJson(req)));
