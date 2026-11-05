import { z } from "zod";
import { AiError, publicSourceUrl, type AiRequest, type AiResponse, type ResponsesProvider } from "../domain/contracts";
import { logger } from "@/shared/logging/logger";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const responseSchema = z.object({
  status: z.enum(["completed", "incomplete", "failed", "in_progress", "queued", "cancelled"]).optional(),
  error: z.unknown().optional(), model: z.string().optional(), output_text: z.string().optional(),
  incomplete_details: z.unknown().optional(),
  usage: z.object({ input_tokens: count, output_tokens: count }).nullish(),
  output: z.array(z.object({
    type: z.string(), status: z.string().optional(),
    action: z.object({ sources: z.array(z.object({ url: z.string() })).optional() }).optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional(),
      annotations: z.array(z.object({ type: z.string(), url: z.string().optional() })).optional(),
    })).optional(),
  })).default([]),
});
export interface YandexClientConfig { apiKey: string; folder: string; baseUrl: string; timeoutMs: number }

/** Server-side only. No SDK, retries, body logging, raw provider errors or response persistence. */
export class YandexResponsesClient implements ResponsesProvider {
  readonly mode = "live" as const;
  constructor(private readonly config: YandexClientConfig, private readonly fetcher: typeof fetch = fetch) {
    if (typeof window !== "undefined") throw new AiError("AI_SERVER_ONLY");
    if (config.baseUrl !== "https://ai.api.cloud.yandex.net/v1" || !/^[\w-]+$/.test(config.folder) || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) throw new AiError("AI_INVALID_CONFIG");
  }
  async respond(request: AiRequest): Promise<AiResponse> {
    if (!this.config.apiKey) throw new AiError("AI_NOT_CONFIGURED");
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new AiError("AI_INVALID_REQUEST");
    const model = `gpt://${this.config.folder}/${request.model}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}/responses`, {
        method: "POST", redirect: "error", signal: abort.signal,
        headers: { Authorization: `Api-Key ${this.config.apiKey}`, "OpenAI-Project": this.config.folder, "x-folder-id": this.config.folder, "Content-Type": "application/json" },
        body: JSON.stringify({ model, instructions: request.instructions, input: request.input,
          store: false, stream: false, max_output_tokens: request.maxOutputTokens,
          ...(request.responseSchema ? { text: { format: { type: "json_schema", name: "crm_result", schema: request.responseSchema, strict: request.responseSchemaStrict ?? false } } } : {}),
          ...(request.tools ? { tools: request.tools, max_tool_calls: 1 } : {}),
        }),
      });
      if (!response.ok) throw new AiError(response.status === 429 ? "AI_PROVIDER_RATE_LIMIT" : "AI_PROVIDER_ERROR");
      // Avoid unbounded error/output bodies. The timer covers body consumption too.
      const reader = response.body?.getReader();
      if (!reader) throw new AiError("AI_INVALID_RESPONSE");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 2000000) { await reader.cancel(); throw new AiError("AI_INVALID_RESPONSE"); }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = responseSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed.success) throw new AiError("AI_INVALID_RESPONSE");
      const data = parsed.data;
      const providerError = data.error as { code?: unknown; message?: unknown } | null | undefined;
      if (providerError?.code || providerError?.message || (data.status && data.status !== "completed")) {
        // Never log error.message or arbitrary provider strings: they can echo input/credentials.
        const codes = ["invalid_request_error", "invalid_json_schema", "invalid_schema", "unsupported_parameter", "unsupported_value", "model_not_found", "server_error", "rate_limit_exceeded", "content_filter", "invalid_prompt", "invalid_request", "internal_error"];
        const reasons = ["max_output_tokens", "content_filter", "max_tool_calls"];
        const details = data.incomplete_details as { reason?: unknown } | null | undefined;
        logger.warn({ status: data.status ?? "unknown", model: request.model,
          error: { code: typeof providerError?.code === "string" && codes.includes(providerError.code) ? providerError.code : providerError?.code == null ? null : "unrecognized_code" },
          incomplete_details: { reason: typeof details?.reason === "string" && reasons.includes(details.reason) ? details.reason : details?.reason == null ? null : "unrecognized_reason" } }, "AI provider did not complete");
        throw new AiError("AI_INCOMPLETE_RESPONSE");
      }
      const contents = data.output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
      if (contents.some((c) => c.type === "refusal")) throw new AiError("AI_REFUSED");
      const text = contents.filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("") || data.output_text || "";
      if (!text) throw new AiError("AI_INVALID_RESPONSE");
      const urls = [...contents.flatMap((c) => c.annotations?.filter((a) => a.type === "url_citation").map((a) => a.url ?? "") ?? []),
        ...data.output.filter((o) => o.type === "web_search_call").flatMap((o) => o.action?.sources?.map((s) => s.url) ?? [])];
      return { text, model, mode: "live", usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : undefined,
        webSearchCalls: data.output.filter((o) => o.type === "web_search_call").length,
        sourceUrls: [...new Set(urls.map(publicSourceUrl).filter((u): u is string => u !== null))],
      };
    } catch (error) {
      if (abort.signal.aborted) throw new AiError("AI_TIMEOUT");
      if (error instanceof AiError) throw error;
      throw new AiError("AI_PROVIDER_ERROR");
    } finally { clearTimeout(timer); }
  }
}
