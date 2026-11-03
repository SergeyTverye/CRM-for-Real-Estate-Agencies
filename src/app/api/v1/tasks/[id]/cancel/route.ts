import { api, readJson } from "@/server/api-handler";
import { cancelTask } from "@/modules/tasks/application/task-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => cancelTask(actor, params.id, await readJson(req)));
