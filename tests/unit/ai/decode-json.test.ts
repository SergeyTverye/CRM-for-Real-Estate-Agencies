import { describe, expect, it } from "vitest";
import { decodeAiJson } from "@/modules/ai/domain/decode-json";
import { parseResultSchema } from "@/modules/ai/domain/contracts";
describe("AI JSON extraction", () => {
  it.each(["%s", "```json\n%s\n```", "Вот результат:\n%s\nПроверьте условия.", "\ufeff%s"])("accepts one valid JSON object without modifying fields", (wrap) => {
    const value = JSON.stringify({ filters: { operation: "sale", requiredFeatures: ['вход {отдельный} "да"'] }, clarificationQuestion: null });
    expect(decodeAiJson(parseResultSchema, wrap.replace("%s", value)).filters?.requiredFeatures).toEqual(['вход {отдельный} "да"']);
  });
  it.each(["{} {}", '{"filters":{"operation":"sale"},"clarificationQuestion":null} {', "{\"filters\":null", "plain text", '{"filters":{"operation":"sale","priceTo":100},"clarificationQuestion":null}',
    '{"filters":{"operation":"rent"},"clarificationQuestion":null}', '{"filters":{"operation":"sale","secret":"x"},"clarificationQuestion":null}'])("rejects ambiguous, truncated and schema-invalid results", (text) => {
    expect(() => decodeAiJson(parseResultSchema, text)).toThrow("AI_INVALID_JSON_RESULT");
  });
});
