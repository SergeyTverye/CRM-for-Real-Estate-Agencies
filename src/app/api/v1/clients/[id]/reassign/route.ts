import { api, readJson } from "@/server/api-handler";
import { reassignClient } from "@/modules/clients/application/client-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => {
  await reassignClient(actor, params.id, await readJson(req));
  return { ok: true };
});
