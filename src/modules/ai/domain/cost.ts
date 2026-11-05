import { AiError, type TokenUsage } from "./contracts";

/** All money is integer micro-RUB (1 RUB = 1,000,000); no floating-point accounting. */
export function rubToMicros(rub: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(rub)) throw new AiError("AI_INVALID_MONEY");
  const [whole = "0", fraction = ""] = rub.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}
export interface AiTariff {
  id: string; model: string; effectiveFrom: Date; effectiveUntil?: Date;
  inputMicrosPerMillion: bigint; outputMicrosPerMillion: bigint; webSearchMicrosPerCall: bigint;
  /** Conservative billed search-context bound per response; supplied with reviewed tariff. */
  webInputTokenAllowance: number;
}
export interface TariffRepository { findEffective(model: string, at: Date): Promise<AiTariff | null> }
export function calculateCost(tariff: AiTariff, usage: TokenUsage, webCalls: number): bigint {
  for (const n of [usage.inputTokens, usage.outputTokens, webCalls, tariff.webInputTokenAllowance]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new AiError("AI_INVALID_USAGE");
  }
  if ([tariff.inputMicrosPerMillion, tariff.outputMicrosPerMillion, tariff.webSearchMicrosPerCall].some((v) => v < 0n)) throw new AiError("AI_INVALID_TARIFF");
  const numerator = BigInt(usage.inputTokens) * tariff.inputMicrosPerMillion + BigInt(usage.outputTokens) * tariff.outputMicrosPerMillion;
  return (numerator + 999999n) / 1000000n + BigInt(webCalls) * tariff.webSearchMicrosPerCall;
}
