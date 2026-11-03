import { api } from "@/server/api-handler";
import { removeClientContact } from "@/modules/clients/application/client-service";

export const DELETE = api<{ id: string; contactId: string }>({}, async ({ actor, params }) => {
  await removeClientContact(actor, params.id, params.contactId);
  return { ok: true };
});
