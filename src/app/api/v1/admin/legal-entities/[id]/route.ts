import { api, readJson } from "@/server/api-handler";
import { updateLegalEntity } from "@/modules/legal-entities/application/legal-entity-service";

export const PATCH = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => updateLegalEntity(actor, params.id, await readJson(req)));
