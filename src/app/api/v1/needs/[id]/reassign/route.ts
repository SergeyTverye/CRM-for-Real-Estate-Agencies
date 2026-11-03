import { api, readJson } from "@/server/api-handler";
import { reassignNeed } from "@/modules/needs/application/need-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => {
  await reassignNeed(actor, params.id, await readJson(req));
  return { ok: true };
});
