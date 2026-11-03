import { api } from "@/server/api-handler";
import { archiveAgreement } from "@/modules/agreements/application/agreement-service";

export const POST = api<{ id: string }>({}, async ({ actor, params }) => {
  await archiveAgreement(actor, params.id);
  return { ok: true };
});
