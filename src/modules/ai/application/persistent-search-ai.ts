import { getConfig } from "@/shared/config/env";
import { createSearchAi } from "../infrastructure/create-search-ai";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs } from "../infrastructure/prisma-repositories";
import { effectiveAiSettings } from "./settings-service";
import { db } from "@/shared/db/client";
import { lockAi, singleton } from "../infrastructure/prisma-repositories";

/** Server composition entrypoint; never falls back to process-local accounting. */
export async function createPersistentSearchAi() {
  const config = getConfig();
  const row = await db.$transaction(async (tx) => { await lockAi(tx); return singleton(tx); });
  const { values } = effectiveAiSettings(row, config);
  return createSearchAi({ ...config, YANDEX_CLOUD_MODEL: values.model, YANDEX_CLOUD_WEB_MODEL: values.webModel,
    YANDEX_WEB_SEARCH_CONTEXT_SIZE: values.searchContextSize },
    { ledger: new PrismaAiLedger(), settings: new PrismaAiSettings(), tariffs: new PrismaAiTariffs() });
}
