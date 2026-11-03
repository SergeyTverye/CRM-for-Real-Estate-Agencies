import { api } from "@/server/api-handler";
import { removeDealParty } from "@/modules/deals/application/deal-service";

export const DELETE = api<{ id: string; partyId: string }>({}, async ({ actor, params }) => {
  await removeDealParty(actor, params.id, params.partyId);
  return { ok: true };
});
