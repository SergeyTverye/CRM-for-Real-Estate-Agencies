import type { AiRequest, AiResponse, ResponsesProvider } from "../domain/contracts";
import type { AiLedgerRepository, AiLedgerTransaction, AiReservation } from "../domain/gate";

/** Explicit test/demo provider. Never falls back from a live provider silently. */
export class FakeResponsesProvider implements ResponsesProvider {
  readonly mode = "test" as const;
  readonly requests: AiRequest[] = [];
  constructor(private readonly reply: (request: AiRequest) => Partial<AiResponse> = () => ({ text: '{"filters":{"operation":"sale"},"clarificationQuestion":null}' })) {}
  async respond(request: AiRequest): Promise<AiResponse> {
    this.requests.push(structuredClone(request));
    return { text: "{}", model: request.model, usage: { inputTokens: 100, outputTokens: 50 }, webSearchCalls: 0, sourceUrls: [], ...this.reply(request), mode: "test" };
  }
}

/** Test/demo only, process-local mutex with rollback. Production needs durable SERIALIZABLE storage. */
export class InMemoryAiLedger implements AiLedgerRepository {
  private rows = new Map<string, AiReservation>();
  private queue: Promise<unknown> = Promise.resolve();
  atomic<T>(work: (tx: AiLedgerTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const rows = structuredClone(this.rows);
      const tx: AiLedgerTransaction = {
        find: async (id) => structuredClone(rows.get(id) ?? null),
        insert: async (r) => { if (rows.has(r.requestId)) throw new Error("Duplicate reservation"); rows.set(r.requestId, structuredClone(r)); },
        update: async (r) => { rows.set(r.requestId, structuredClone(r)); },
        usage: async (q) => {
          const all = [...rows.values()];
          const user = all.filter((r) => r.userId === q.userId);
          const job = all.filter((r) => r.jobId === q.jobId);
          return {
            userHourCalls: user.filter((r) => r.createdAt >= q.hourSince).length,
            userDayCalls: user.filter((r) => r.dayKey === q.dayKey).length,
            jobCalls: job.length,
            jobWebCalls: job.filter((r) => (r.callType === "web_search" || r.callType === "chat_web")).reduce((n, r) => n + Math.max(r.estimatedWebCalls, r.webSearchCalls ?? 0), 0),
            userDayWebJobIds: [...new Set(user.filter((r) => r.dayKey === q.dayKey && (r.callType === "web_search" || r.callType === "chat_web")).map((r) => r.jobId))],
            monthCommittedMicros: all.filter((r) => r.monthKey === q.monthKey).reduce((n, r) => n + r.chargedMicros, 0n),
            dayCalls: all.filter((r) => r.dayKey === q.dayKey).length,
          };
        },
      };
      const result = await work(tx);
      this.rows = rows;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
