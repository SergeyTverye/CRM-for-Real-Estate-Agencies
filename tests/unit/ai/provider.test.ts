import { describe, expect, it, vi } from "vitest";
import { YandexResponsesClient } from "@/modules/ai/infrastructure/yandex-responses-client";
import { redactContacts, publicSourceUrl } from "@/modules/ai/domain/contracts";

const request = { model: "demo-model", input: "synthetic", instructions: "JSON only", maxOutputTokens: 100 };
const config = { apiKey: "synthetic-key-for-tests", folder: "synthetic-folder", baseUrl: "https://ai.api.cloud.yandex.net/v1", timeoutMs: 1000 };
describe("YandexResponsesClient", () => {
  it("sends Api-Key/project, gpt URI and store=false; extracts usage, citations and web calls", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "completed", usage: { input_tokens: 20, output_tokens: 10 }, output: [
      { type: "web_search_call", action: { sources: [{ url: "https://example.com/listing" }] } },
      { type: "message", content: [{ type: "output_text", text: "{}", annotations: [{ type: "url_citation", url: "https://example.com/other" }] }] },
    ] }));
    const result = await new YandexResponsesClient(config, fetcher).respond(request);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://ai.api.cloud.yandex.net/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Api-Key synthetic-key-for-tests", "OpenAI-Project": "synthetic-folder", "x-folder-id": "synthetic-folder" });
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "gpt://synthetic-folder/demo-model", store: false, max_output_tokens: 100 });
    expect(JSON.parse(init!.body as string)).not.toHaveProperty("tools");
    expect(result).toMatchObject({ usage: { inputTokens: 20, outputTokens: 10 }, webSearchCalls: 1, sourceUrls: ["https://example.com/other", "https://example.com/listing"] });
  });
  it("sanitizes HTTP and transport errors, even when provider echoes credentials", async () => {
    const provider = new YandexResponsesClient(config, vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic-key-for-tests secret body", { status: 500 })));
    await expect(provider.respond(request)).rejects.toThrow(/^AI_PROVIDER_ERROR$/);
    const network = new YandexResponsesClient(config, vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic-key-for-tests")));
    await expect(network.respond(request)).rejects.toThrow(/^AI_PROVIDER_ERROR$/);
  });
  it.each([
    { output_text: "{}", usage: { input_tokens: -1, output_tokens: 1 } },
    { output_text: "{}", status: "incomplete" },
    { output: [{ type: "message", content: [{ type: "refusal" }] }] },
  ])("rejects invalid/incomplete/refused responses", async (body) => {
    const provider = new YandexResponsesClient(config, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(provider.respond(request)).rejects.toThrow(/^AI_/);
  });
  it("supports absent usage without inventing zero tokens", async () => {
    const provider = new YandexResponsesClient(config, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: "{}" })));
    expect((await provider.respond(request)).usage).toBeUndefined();
  });
  it("times out without retries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(new YandexResponsesClient({ ...config, timeoutMs: 10 }, fetcher).respond(request)).rejects.toThrow("AI_TIMEOUT");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("removes phones and emails, blocks non-public URL syntax", () => {
    const result = redactContacts("Витрина, +7 (900) 123-45-67, 8 900 987 65 43, user+test@example.com, площадь 45 м²");
    expect(result).not.toMatch(/900|example.com/);
    expect(result).toContain("площадь 45 м²");
    expect(redactContacts("Цена 10000000 рублей, до 9000000, площадь 100 м²")).toBe("Цена 10000000 рублей, до 9000000, площадь 100 м²");
    for (const url of ["http://example.com", "https://127.0.0.1", "https://[::1]", "https://user:pass@example.com", "file:///tmp/x"]) expect(publicSourceUrl(url)).toBeNull();
  });
});
