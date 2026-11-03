import { api } from "@/server/api-handler";
import { revokeOwnerContactAccess } from "@/modules/properties/application/property-service";

export const DELETE = api<{ id: string; grantId: string }>({ access: "manager" }, async ({ actor, params }) => {
  await revokeOwnerContactAccess(actor, params.id, params.grantId);
  return { ok: true };
});
