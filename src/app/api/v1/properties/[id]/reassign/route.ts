import { api, readJson } from "@/server/api-handler";
import { reassignProperty } from "@/modules/properties/application/property-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => {
  await reassignProperty(actor, params.id, await readJson(req));
  return { ok: true };
});
