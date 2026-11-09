import { api } from "@/server/api-handler";
import { listActiveLegalEntities } from "@/modules/legal-entities/application/legal-entity-service";


export const GET = api({}, async () => ({ items: await listActiveLegalEntities() }));
