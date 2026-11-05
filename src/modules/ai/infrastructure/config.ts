import type { AppConfig } from "@/shared/config/env";
import type { AiLimits } from "../domain/gate";
import { rubToMicros } from "../domain/cost";

export function envAiLimits(config: AppConfig): AiLimits {
  return {
    enabled: config.AI_ENABLED, webEnabled: config.YANDEX_WEB_SEARCH_ENABLED,
    autoFallback: config.YANDEX_WEB_SEARCH_AUTO_FALLBACK,
    requestsPerUserHour: config.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR,
    // §5 provides no daily total/job total ENV. Conservative derived safety ceilings;
    // persisted manager settings can tighten them.
    requestsPerUserDay: config.YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR * 8,
    callsPerJob: 10,
    webCallsPerJob: config.YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB,
    webJobsPerUserDay: config.YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY,
    monthlyBudgetMicros: rubToMicros(config.YANDEX_AI_MAX_MONTHLY_COST_RUB),
  };
}
