import { getConfig } from "@/shared/config/env";
import { createSearchAi } from "../infrastructure/create-search-ai";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs } from "../infrastructure/prisma-repositories";
import { effectiveAiSettings } from "./settings-service";
import { db } from "@/shared/db/client";
import { lockAi, singleton } from "../infrastructure/prisma-repositories";
import { aiCredentialsService } from "./credentials-service";
import { ConflictError } from "@/shared/errors";

/** Server composition entrypoint; never falls back to process-local accounting. */
export async function createPersistentSearchAi() {
  const config = getConfig();
  const row = await db.$transaction(async (tx) => { await lockAi(tx); return singleton(tx); });
  const { values } = effectiveAiSettings(row, config);
  const { credentials } = await aiCredentialsService(config).resolve();
  if (!credentials) throw new ConflictError("AI_CREDENTIALS_MISSING", "Требуется подключение Яндекс AI", { settingsUrl: "/settings/ai" });
  return createSearchAi({ ...config, YANDEX_CLOUD_MODEL: values.model, YANDEX_CLOUD_WEB_MODEL: values.webModel,
    YANDEX_CLOUD_API_KEY: credentials.apiKey, YANDEX_CLOUD_FOLDER: credentials.folder,
    YANDEX_WEB_SEARCH_CONTEXT_SIZE: values.searchContextSize },
    { ledger: new PrismaAiLedger(), settings: new PrismaAiSettings(), tariffs: new PrismaAiTariffs() });
}
