import { api } from "@/server/api-handler";
import { removePropertyOwner } from "@/modules/properties/application/property-service";

export const DELETE = api<{ id: string; ownerId: string }>({}, async ({ actor, params }) => {
  await removePropertyOwner(actor, params.id, params.ownerId);
  return { ok: true };
});
