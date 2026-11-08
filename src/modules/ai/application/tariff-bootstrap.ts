import { db, getDb } from "@/shared/db/client";
import { lockAi, PrismaAiTariffs } from "../infrastructure/prisma-repositories";
import { seedAiTariffs } from "./seed-ai";

/** Initial defaults only. The reference seed skips a model with ANY tariff history.
 * No settings, credentials, provider requests or budget mutations belong here.
 */
export async function bootstrapAiTariffs(database: ReturnType<typeof getDb> = db) {
  await database.$transaction(async tx => { await lockAi(tx); await seedAiTariffs(tx); });
}

export const missingTariffMessage = "Для выбранной модели ИИ нет действующего полного тарифа. Руководителю: добавьте тариф или выберите модель с действующим тарифом в настройках ИИ. Ручной поиск доступен.";

/** Same repository/clock policy as paid calls; never reserves money or probes a provider. */
export async function searchTariffsReady(model: string, webModel: string, at = new Date()) {
  const tariffs = new PrismaAiTariffs();
  for (const code of new Set([model, webModel || model])) {
    if (!await tariffs.findEffective(code, at)) return false;
  }
  return true;
}
