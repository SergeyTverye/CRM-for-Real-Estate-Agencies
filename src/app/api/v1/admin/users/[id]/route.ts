import { api, readJson } from "@/server/api-handler";
import { updateUser } from "@/modules/users/application/users-service";

export const PATCH = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) =>
  updateUser(actor, params.id, await readJson(req)),
);
