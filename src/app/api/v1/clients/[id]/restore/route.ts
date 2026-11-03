import { api } from "@/server/api-handler";
import { restoreClient } from "@/modules/clients/application/client-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ actor, params }) => {
  await restoreClient(actor, params.id);
  return { ok: true };
});
