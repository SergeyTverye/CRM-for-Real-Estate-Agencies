import { api, readJson } from "@/server/api-handler";
import { archiveClient } from "@/modules/clients/application/client-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => {
  await archiveClient(actor, params.id, await readJson(req));
  return { ok: true };
});
