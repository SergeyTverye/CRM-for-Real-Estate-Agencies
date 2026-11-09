import type { AppConfig } from "@/shared/config/env";
import type { TariffRepository } from "../domain/cost";
import { AiGate, type AiLedgerRepository, type AiSettingsRepository } from "../domain/gate";
import type { ResponsesProvider } from "../domain/contracts";
import { envAiLimits } from "./config";
import { SearchAi } from "./search-ai";
import { YandexResponsesClient } from "./yandex-responses-client";
import { verifyListingPage } from "./verify-listing-page";


export function createSearchAi(config: AppConfig, repositories: {
  ledger: AiLedgerRepository; settings: AiSettingsRepository; tariffs: TariffRepository;
}, provider?: ResponsesProvider): SearchAi {
  return new SearchAi(provider ?? new YandexResponsesClient({ apiKey: config.YANDEX_CLOUD_API_KEY,
    folder: config.YANDEX_CLOUD_FOLDER, baseUrl: config.YANDEX_CLOUD_BASE_URL, timeoutMs: config.YANDEX_AI_TIMEOUT_MS }),
  new AiGate(repositories.ledger, envAiLimits(config), repositories.settings, config.APP_TIMEZONE), repositories.tariffs,
  { timeZone: config.APP_TIMEZONE, model: config.YANDEX_CLOUD_MODEL, webModel: config.YANDEX_CLOUD_WEB_MODEL,
    maxOutputTokens: config.YANDEX_AI_MAX_OUTPUT_TOKENS, contextSize: config.YANDEX_WEB_SEARCH_CONTEXT_SIZE,
    defaultRegion: config.YANDEX_WEB_SEARCH_REGION, ...(!provider ? { verifyPage: verifyListingPage } : {}),
    allowedDomains: config.YANDEX_WEB_SEARCH_ALLOWED_DOMAINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) });
}
