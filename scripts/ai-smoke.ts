import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/shared/config/env";
import { AiGate } from "../src/modules/ai/domain/gate";
import { envAiLimits } from "../src/modules/ai/infrastructure/config";
import { InMemoryAiLedger } from "../src/modules/ai/infrastructure/fake";
import { YandexResponsesClient } from "../src/modules/ai/infrastructure/yandex-responses-client";
import { SearchAi } from "../src/modules/ai/infrastructure/search-ai";
import { rubToMicros, type AiTariff } from "../src/modules/ai/domain/cost";
import { AiError, type AiResponse } from "../src/modules/ai/domain/contracts";
let observed: AiResponse | undefined;

async function main() {
  if (process.argv.filter((a) => a === "--live").length !== 1) throw new Error("Opt-in required");
  const config = loadConfig();
  if (!config.AI_ENABLED || !config.YANDEX_CLOUD_API_KEY) throw new Error("AI unavailable");
  const tariff: AiTariff = {
    id: "smoke-reviewed", model: process.argv.includes("--web") ? config.YANDEX_CLOUD_WEB_MODEL || config.YANDEX_CLOUD_MODEL : config.YANDEX_CLOUD_MODEL,
    effectiveFrom: new Date(process.env.AI_SMOKE_TARIFF_EFFECTIVE_FROM ?? "invalid"),
    inputMicrosPerMillion: rubToMicros(process.env.AI_SMOKE_INPUT_RUB_PER_MILLION ?? ""),
    outputMicrosPerMillion: rubToMicros(process.env.AI_SMOKE_OUTPUT_RUB_PER_MILLION ?? ""),
    webSearchMicrosPerCall: process.argv.includes("--web") ? rubToMicros("0.915") : 0n, webInputTokenAllowance: process.argv.includes("--web") ? 128000 : 0,
  };
  if (!Number.isFinite(tariff.effectiveFrom.getTime())) throw new Error("Tariff date required");
  const gate = new AiGate(new InMemoryAiLedger(), { ...envAiLimits(config), callsPerJob: 1, requestsPerUserDay: 1 }, { getLimits: async () => ({}) }, config.APP_TIMEZONE);
  const client = new YandexResponsesClient({ apiKey: config.YANDEX_CLOUD_API_KEY, folder: config.YANDEX_CLOUD_FOLDER,
    baseUrl: config.YANDEX_CLOUD_BASE_URL, timeoutMs: config.YANDEX_AI_TIMEOUT_MS }, async (...args) => {
      const res = await fetch(...args);
      if (res.ok) {
        const data = await res.clone().json();
        const status = typeof data.status === "string" && /^[a-z_]+$/.test(data.status) ? data.status : "unknown";
        console.log(JSON.stringify({ status, tokens: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null, model: config.YANDEX_CLOUD_MODEL }));
      }
      return res;
    });
  const ai = new SearchAi({ mode: "live", respond: async (request) => {
    try { observed = await client.respond(request); return observed; }
    catch (e) { console.log(JSON.stringify({ status: e instanceof AiError ? e.code : "failed", tokens: null, model: request.model })); throw e; }
  } }, gate,
    { findEffective: async () => tariff }, { model: config.YANDEX_CLOUD_MODEL, webModel: config.YANDEX_CLOUD_WEB_MODEL, maxOutputTokens: Math.min(1800, config.YANDEX_AI_MAX_OUTPUT_TOKENS),
      contextSize: "low", defaultRegion: "65", allowedDomains: [] });
  const context = { user: { userId: "synthetic-smoke", active: true }, ownerUserId: "synthetic-smoke", jobId: randomUUID(), requestId: randomUUID() };
  const cases = {
    sale: { query: "Купить нежилой офис в Новосибирске, площадь от 50 до 100 м², цена до 10000000 рублей" },
    rent: { query: "Арендовать нежилой офис в Новосибирске от 50 до 100 м², до 100000 рублей в месяц, только первый этаж" },
    clarification: { query: "Аренда офиса в Новосибирске за 100: не знаю, это за метр или за весь офис, в месяц или в год. Уточни единицу цены." },
  };
  const name = process.argv.find((a) => a.startsWith("--case="))?.slice(7) ?? "sale";
  if (!(name in cases)) throw new Error("Unknown synthetic case");
  const result = process.argv.includes("--web") ? await ai.webSearch(context, { operation: "sale", purposes: ["office"] }) : await ai.parseSearchQuery(context,
    cases[name as keyof typeof cases]);
  console.log(JSON.stringify({ status: "clarificationQuestion" in result && result.clarificationQuestion ? "clarification" : "ok", tokens: result.usage ?? null, model: result.model }));
}
main().catch((e) => { console.log(JSON.stringify({ status: e instanceof AiError ? e.code : "configuration_failed", tokens: observed?.usage ?? null, model: observed?.model ?? null })); process.exitCode = 1; });
