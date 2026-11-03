import { api, json, readJson } from "@/server/api-handler";
import { createTask } from "@/modules/tasks/application/task-service";
import { listTasks } from "@/modules/tasks/application/task-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listTasks(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createTask(actor, await readJson(req)), 201));
