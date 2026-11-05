/** Opt-in, exactly one synthetic parse request. Never invoked by unit tests.
 * Run: npx tsx --env-file=.env scripts/ai-smoke.ts --live
 * No automatic retry; output is limited to status/tokens/model.
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/shared/config/env";
import { AiGate } from "../src/modules/ai/domain/gate";
import { envAiLimits } from "../src/modules/ai/infrastructure/config";
import { InMemoryAiLedger } from "../src/modules/ai/infrastructure/fake";
import { YandexResponsesClient } from "../src/modules/ai/infrastructure/yandex-responses-client";
import { SearchAi } from "../src/modules/ai/infrastructure/search-ai";
import { rubToMicros, type AiTariff } from "../src/modules/ai/domain/cost";

async function main() {
  if (process.argv.filter((a) => a === "--live").length !== 1) throw new Error("Opt-in required");
  const config = loadConfig();
  if (!config.AI_ENABLED || !config.YANDEX_CLOUD_API_KEY) throw new Error("AI unavailable");
  // Reviewed rates required from coordinator; never fabricate current commercial tariffs.
  const tariff: AiTariff = {
    id: "smoke-reviewed", model: config.YANDEX_CLOUD_MODEL,
    effectiveFrom: new Date(process.env.AI_SMOKE_TARIFF_EFFECTIVE_FROM ?? "invalid"),
    inputMicrosPerMillion: rubToMicros(process.env.AI_SMOKE_INPUT_RUB_PER_MILLION ?? ""),
    outputMicrosPerMillion: rubToMicros(process.env.AI_SMOKE_OUTPUT_RUB_PER_MILLION ?? ""),
    webSearchMicrosPerCall: 0n, webInputTokenAllowance: 0,
  };
  if (!Number.isFinite(tariff.effectiveFrom.getTime())) throw new Error("Tariff date required");
  const gate = new AiGate(new InMemoryAiLedger(), { ...envAiLimits(config), callsPerJob: 1, requestsPerUserDay: 1 }, { getLimits: async () => ({}) }, config.APP_TIMEZONE);
  const ai = new SearchAi(new YandexResponsesClient({ apiKey: config.YANDEX_CLOUD_API_KEY, folder: config.YANDEX_CLOUD_FOLDER,
    baseUrl: config.YANDEX_CLOUD_BASE_URL, timeoutMs: config.YANDEX_AI_TIMEOUT_MS }), gate,
    { findEffective: async () => tariff }, { model: config.YANDEX_CLOUD_MODEL, webModel: "", maxOutputTokens: Math.min(500, config.YANDEX_AI_MAX_OUTPUT_TOKENS),
      contextSize: "low", defaultRegion: "65", allowedDomains: [] });
  const result = await ai.parseSearchQuery({ user: { userId: "synthetic-smoke", active: true }, ownerUserId: "synthetic-smoke", jobId: randomUUID(), requestId: randomUUID() },
    { query: "Купить нежилой офис в Новосибирске, площадь от 50 до 100 м², цена до 10000000 рублей" });
  console.log(JSON.stringify({ status: result.clarificationQuestion ? "clarification" : "ok", tokens: result.usage ?? null, model: result.model }));
}
main().catch(() => { console.log(JSON.stringify({ status: "failed", tokens: null, model: null })); process.exitCode = 1; });
