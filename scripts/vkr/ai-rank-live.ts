import { writeFileSync } from "node:fs";
import { SearchAi } from "../../src/modules/ai/infrastructure/search-ai";
import { YandexResponsesClient } from "../../src/modules/ai/infrastructure/yandex-responses-client";
import { InMemoryAiLedger } from "../../src/modules/ai/infrastructure/fake";
import { AiGate } from "../../src/modules/ai/domain/gate";
import { AiError, type AiResponse, type ResponsesProvider } from "../../src/modules/ai/domain/contracts";

const syntheticRankingInput = { items: [1, 2, 3].map((_, index) => ({
  listingId: `00000000-0000-4000-8000-00000000000${index + 1}`,
  criteria: [
    { criterion: "city", state: "matched", evidence: "Город: Новосибирск" },
    { criterion: "operation", state: "matched", evidence: "sale" },
    { criterion: "purpose", state: index === 1 ? "unknown" : "matched", evidence: index === 1 ? "Категория ПСН OnRealt; торговое назначение требует проверки" : "retail" },
    { criterion: "priceUnit", state: "unknown", evidence: "Несовместимые или неизвестные единицы цены" },
    { criterion: "area", state: index === 2 ? "contradicted" : "matched", evidence: `Площадь: ${60 + index * 30} м²` },
    { criterion: "price", state: "unknown", evidence: "Период цены не указан" },
    { criterion: "floor", state: index === 2 ? "unknown" : "matched", evidence: index === 2 ? "Этаж неизвестен" : "1" },
  ], pricePeriodNotice: "Период цены неизвестен — цены несопоставимы до проверки",
})) };

async function main() {
  if (!process.env.YANDEX_CLOUD_API_KEY || !process.env.YANDEX_CLOUD_FOLDER) throw new Error("Missing Yandex credentials in process environment");
  const model = "aliceai-llm-flash/latest";
  const client = new YandexResponsesClient({ apiKey: process.env.YANDEX_CLOUD_API_KEY,
    folder: process.env.YANDEX_CLOUD_FOLDER, baseUrl: "https://ai.api.cloud.yandex.net/v1", timeoutMs: 30000 });
  let calls = 0;
  const provider: ResponsesProvider = { mode: "live", respond: async request => {
    if (++calls > 1) throw new Error("One paid call only; no retry");
    const response: AiResponse = await client.respond(request);
    console.log(JSON.stringify({ maxOutputTokens: request.maxOutputTokens, usage: response.usage, rawSyntheticText: response.text.slice(0, 6000) }));
    if (process.argv.includes("--record-replay")) writeFileSync("tests/unit/ai/fixtures/ranking-live-synthetic.txt", response.text);
    return response;
  } };
  const ledger = new InMemoryAiLedger();
  const gate = new AiGate(ledger, { enabled: true, webEnabled: false, autoFallback: false,
    requestsPerUserHour: 1, requestsPerUserDay: 1, callsPerJob: 1, webCallsPerJob: 0, webJobsPerUserDay: 0,
    monthlyBudgetMicros: 2000000n }, { getLimits: async () => ({}) });
  const ai = new SearchAi(provider, gate, { findEffective: async () => ({ id: "diagnostic", model,
    effectiveFrom: new Date("2026-01-01Z"), inputMicrosPerMillion: 100000000n, outputMicrosPerMillion: 200000000n,
    webSearchMicrosPerCall: 0n, webInputTokenAllowance: 0 }) }, { model, webModel: "", maxOutputTokens: Number(process.env.YANDEX_AI_MAX_OUTPUT_TOKENS ?? 1800),
    contextSize: "low", defaultRegion: "65", allowedDomains: [] });
  try {
    const result = await ai.rankListings({ user: { userId: "synthetic", active: true }, ownerUserId: "synthetic", jobId: "synthetic", requestId: "diagnostic" }, syntheticRankingInput);
    console.log(JSON.stringify({ outcome: "PASS", ranking: result.ranking }));
  } catch (error) {
    console.log(JSON.stringify({ outcome: "FAIL", code: error instanceof AiError ? error.code : "DIAGNOSTIC_FAILED" }));
    process.exitCode = 1;
  } finally {
    const row = await ledger.atomic(tx => tx.find("diagnostic"));
    console.log(JSON.stringify({ calls, usage: row?.usage, estimated: row?.estimated, chargedRub: row ? Number(row.chargedMicros) / 1000000 : null }));
  }
}
void main().catch(() => { console.error("Diagnostic could not start; check environment (secrets are not printed)."); process.exitCode = 1; });
