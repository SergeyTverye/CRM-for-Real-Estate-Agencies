import type { AppConfig } from "@/shared/config/env";
import { createSearchAi } from "@/modules/ai/infrastructure/create-search-ai";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs } from "@/modules/ai/infrastructure/prisma-repositories";

/** Explicit demo provider still passes through the durable gate/limits; no paid network calls. */
export function createDemoSearchAi(config: AppConfig) {
  const provider = new FakeResponsesProvider(request => {
    if (request.tools?.length) return { text: JSON.stringify({ candidates: [{ title: "Демонстрационное объявление: требуется проверка первоисточника", url: "https://cian.ru/synthetic-101" }] }),
      webSearchCalls: 1, sourceUrls: ["https://cian.ru/synthetic-101"] };
    if (request.instructions.includes("unresolvedCriteria")) return { text: '{"evidence":[]}' };
    const input = JSON.parse(request.input) as { currentFilters?: unknown };
    return { text: JSON.stringify({ filters: input.currentFilters ?? null, clarificationQuestion: "Тестовый ИИ: скорректируйте условия вручную и подтвердите поиск." }) };
  });
  return createSearchAi(config, { ledger: new PrismaAiLedger(), settings: new PrismaAiSettings(), tariffs: new PrismaAiTariffs() }, provider);
}
