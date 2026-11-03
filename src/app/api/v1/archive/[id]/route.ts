import { api } from "@/server/api-handler";
import { getArchiveRecord } from "@/modules/archive/application/archive-service";

export const GET = api<{ id: string }>({ access: "manager" }, async ({ actor, params }) => getArchiveRecord(actor, params.id));
