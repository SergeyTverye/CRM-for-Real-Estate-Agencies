import type { DbOrTx } from "@/shared/db/client";
import { writeAudit } from "@/modules/audit/application/audit";


export async function seedAiTariffs(tx: DbOrTx) {
  const effectiveFrom = new Date("2026-11-05T00:00:00Z");
  const source = "https://aistudio.yandex.ru/ru/docs/ai-studio/pricing";
  for (const [model, input, output] of [["aliceai-llm-flash/latest", "100", "200"], ["yandexgpt/latest", "800", "800"]] as const) {
    if (await tx.aiTariff.count({ where: { model } })) continue;
    await tx.aiTariff.createMany({ data: [
      { model, callType: "parse", unit: "input_million_tokens", priceRub: input, effectiveFrom },
      { model, callType: "parse", unit: "output_million_tokens", priceRub: output, effectiveFrom },
      { model, callType: "parse", unit: "web_search_call", priceRub: "0.915", effectiveFrom },
    ], skipDuplicates: true });
    const first = await tx.aiTariff.findFirstOrThrow({ where: { model, effectiveFrom } });
    await writeAudit(tx, { action: "ai.tariff.seed", entityType: "AiTariff", entityId: first.id,
      after: { model, source, checkedAt: "2026-11-05", confirmation: "Требует подтверждения руководителем", inputRubPerMillion: input,
        outputRubPerMillion: output, webRubPerCall: "0.915", note: "Токены инструментов консервативно считаются по полной входной цене" } });
  }
}
