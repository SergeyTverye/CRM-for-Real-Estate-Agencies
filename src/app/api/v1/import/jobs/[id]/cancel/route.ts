import { api } from "@/server/api-handler";
import { cancelImport } from "@/modules/import/application/import-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ actor, params }) => {
  await cancelImport(actor, params.id);
  return { ok: true };
});
