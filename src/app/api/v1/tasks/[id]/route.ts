import { api, readJson } from "@/server/api-handler";
import { updateTask } from "@/modules/tasks/application/task-service";
import { getTask } from "@/modules/tasks/application/task-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getTask(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateTask(actor, params.id, await readJson(req)));
