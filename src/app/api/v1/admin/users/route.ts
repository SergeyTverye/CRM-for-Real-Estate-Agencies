import { api, json, readJson } from "@/server/api-handler";
import { createUser, listUsers } from "@/modules/users/application/users-service";

export const GET = api({ access: "manager" }, async ({ actor }) => ({ items: await listUsers(actor) }));

export const POST = api({ access: "manager" }, async ({ req, actor }) => json(await createUser(actor, await readJson(req)), 201));
