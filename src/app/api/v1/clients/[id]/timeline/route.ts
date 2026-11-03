import { api } from "@/server/api-handler";
import { getClientTimeline } from "@/modules/clients/application/client-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => ({ items: await getClientTimeline(actor, params.id) }));
