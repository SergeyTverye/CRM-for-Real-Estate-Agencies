import { api, json, readJson } from "@/server/api-handler";
import { createLegalEntity, listLegalEntities } from "@/modules/legal-entities/application/legal-entity-service";

export const GET = api({ access: "manager" }, async ({ actor }) => ({ items: await listLegalEntities(actor) }));
export const POST = api({ access: "manager" }, async ({ req, actor }) => json(await createLegalEntity(actor, await readJson(req)), 201));
