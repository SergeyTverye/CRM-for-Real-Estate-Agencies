import { expect, it, vi } from "vitest";
import { SearchAi } from "@/modules/ai/infrastructure/search-ai";
import { FakeResponsesProvider, InMemoryAiLedger } from "@/modules/ai/infrastructure/fake";
import { AiGate } from "@/modules/ai/domain/gate";
import { SearchFilters } from "@/modules/property-search/domain/types";

it("missing custom tariff rejects before ledger/reservation/provider, even when AI is enabled", async () => {
  const ledger = new InMemoryAiLedger(), atomic = vi.spyOn(ledger, "atomic");
  const provider = new FakeResponsesProvider();
  const gate = new AiGate(ledger, { enabled: true, webEnabled: true, autoFallback: false,
    requestsPerUserHour: 30, requestsPerUserDay: 240, callsPerJob: 10, webCallsPerJob: 1,
    webJobsPerUserDay: 3, monthlyBudgetMicros: 1000000n }, { getLimits: async () => ({}) });
  const ai = new SearchAi(provider, gate, { findEffective: async () => null },
    { model: "custom/latest", webModel: "custom/latest", maxOutputTokens: 100, contextSize: "low", defaultRegion: "65", allowedDomains: [] });
  await expect(ai.parseSearchQuery({ user: { userId: "synthetic", active: true }, ownerUserId: "synthetic", jobId: "job", requestId: "request" },
    { query: "Аренда офиса", currentFilters: SearchFilters.parse({ operation: "rent", priceUnit: "rub_month" }) })).rejects.toThrow("AI_TARIFF_UNAVAILABLE");
  expect(atomic).not.toHaveBeenCalled(); expect(provider.requests).toHaveLength(0);
});
