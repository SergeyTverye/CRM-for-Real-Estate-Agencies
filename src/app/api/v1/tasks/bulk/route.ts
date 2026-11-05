import { api, readJson } from "@/server/api-handler";
import { bulkCreateTasks } from "@/modules/tasks/application/bulk-task-service";
export const POST = api({}, async ({ actor, req }) => bulkCreateTasks(actor, await readJson(req)));
