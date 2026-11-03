import { api, readJson } from "@/server/api-handler";
import { commitImport } from "@/modules/import/application/import-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => commitImport(actor, params.id, await readJson(req)));
