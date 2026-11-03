import { api } from "@/server/api-handler";
import { pickClients } from "@/modules/clients/application/client-queries";

export const GET = api({}, async ({ req, actor }) => ({ items: await pickClients(actor, req.nextUrl.searchParams.get("q") ?? undefined) }));
