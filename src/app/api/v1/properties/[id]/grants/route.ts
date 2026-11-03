import { api, json, readJson } from "@/server/api-handler";
import { grantOwnerContactAccess } from "@/modules/properties/application/property-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => json(await grantOwnerContactAccess(actor, params.id, await readJson(req)), 201));
