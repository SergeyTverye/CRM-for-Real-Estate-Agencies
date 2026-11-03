import { api } from "@/server/api-handler";
import { listActiveLegalEntities } from "@/modules/legal-entities/application/legal-entity-service";

/** Активные ИП/ООО для выбора в формах сделок, договоров и КП (любой аутентифицированный пользователь). */
export const GET = api({}, async () => ({ items: await listActiveLegalEntities() }));
