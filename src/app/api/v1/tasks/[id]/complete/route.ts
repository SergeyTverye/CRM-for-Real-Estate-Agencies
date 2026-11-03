import { api, readJson } from "@/server/api-handler";
import { completeTask } from "@/modules/tasks/application/task-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => completeTask(actor, params.id, await readJson(req)));
