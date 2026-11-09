import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import { getSearchAi, type SearchAiPort } from "@/modules/property-search/application/dependencies";
import { DomainError, StaleUpdateError } from "@/shared/errors";
import { parseInput } from "@/shared/validation";
import { AiError } from "@/modules/ai/domain/contracts";
import { getDuplicateGroup } from "./duplicate-service";

export async function explainDuplicateGroup(actor: Actor, id: string, raw: unknown, injected?: Pick<SearchAiPort, "analyzeDescriptions">) {
  const input = parseInput(z.object({ confirmedPaid: z.literal(true), expectedUpdatedAt: z.iso.datetime() }).strict(), raw);
  const group = await getDuplicateGroup(actor, id);
  if (group.updatedAt !== input.expectedUpdatedAt) throw new StaleUpdateError();
  if (!["probable", "deferred"].includes(group.status)) throw new DomainError("DUPLICATE_NOT_DISPUTED", "Объяснение доступно для спорной группы");
  if (!group.evidence.pairs.length) throw new DomainError("DUPLICATE_NO_PAIRS", "Недостаточно действующих объявлений для сравнения");
  const ai = injected ?? await getSearchAi();
  if (!ai) throw new DomainError("AI_DISABLED", "ИИ отключён. Решение можно принять по признакам ниже.");
  const jobId = randomUUID();
  try {
    const result = await ai.analyzeDescriptions({ user: { userId: actor.userId, active: true }, ownerUserId: actor.userId,
      jobId, requestId: `duplicate-explanation:${randomUUID()}` }, {
      listings: group.evidence.pairs.slice(0, 20).map((p, i) => ({ id: `pair-${i + 1}`, publicDescription: p.features.map(f => `${f.feature}: ${f.state}; ${f.explanation}`).join("\n") })),
      unresolvedCriteria: ["Есть совпадающие признаки", "Есть различающиеся признаки", "Недостаточно сведений для доказанной идентичности"],
    });
    return { ...result, expectedUpdatedAt: group.updatedAt, humanConfirmationRequired: true as const, truncated: group.evidence.pairs.length > 20 };
  } catch (error) {
    if (error instanceof AiError) throw new DomainError(error.code, "Не удалось получить объяснение. Проверьте настройки и лимиты ИИ.");
    throw error;
  }
}
