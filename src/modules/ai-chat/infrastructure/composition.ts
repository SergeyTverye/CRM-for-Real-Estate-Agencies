import { estimatedChatInputTokens } from "../domain/policy";
import { randomUUID, createHash } from "node:crypto";
import { getConfig } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { AiGate } from "@/modules/ai/domain/gate";
import { AiError, type AiRequest, type ResponsesProvider } from "@/modules/ai/domain/contracts";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { PrismaAiLedger, PrismaAiSettings, PrismaAiTariffs, aiUsageLogId, singleton } from "@/modules/ai/infrastructure/prisma-repositories";
import { effectiveAiSettings } from "@/modules/ai/application/settings-service";
import { YandexResponsesClient } from "@/modules/ai/infrastructure/yandex-responses-client";
import type { Actor } from "@/modules/auth/domain/actor";
export async function chatRuntime(actor: Actor, sessionId: string, injected?: ResponsesProvider) {
    const cfg = getConfig();
    const { values } = effectiveAiSettings(await singleton(db), cfg);
    const gate = new AiGate(new PrismaAiLedger(), envAiLimits(cfg), new PrismaAiSettings(), cfg.APP_TIMEZONE);
    const provider = injected ?? new YandexResponsesClient({ apiKey: cfg.YANDEX_CLOUD_API_KEY, folder: cfg.YANDEX_CLOUD_FOLDER, baseUrl: cfg.YANDEX_CLOUD_BASE_URL, timeoutMs: cfg.YANDEX_AI_TIMEOUT_MS });
    const turnId = randomUUID();
    return { model: values.model, webModel: values.webModel, async call(request: AiRequest, web = false) {
            request={...request,maxOutputTokens:Math.min(request.maxOutputTokens,cfg.YANDEX_AI_MAX_OUTPUT_TOKENS)};
            const tariff = await new PrismaAiTariffs().findEffective(request.model, new Date());
            if (!tariff)
                throw new AiError("AI_TARIFF_UNAVAILABLE");
            const requestId = `chat:${sessionId}:${randomUUID()}`;
            await gate.check(web ? "chat_web" : "chat", { userId: actor.userId, active: true }, { id: turnId, ownerUserId: actor.userId, requestId, fingerprint: createHash("sha256").update(JSON.stringify(request)).digest("hex"), model: request.model, estimatedUsage: { inputTokens: estimatedChatInputTokens(request) + (web ? tariff.webInputTokenAllowance : 0), outputTokens: request.maxOutputTokens }, estimatedWebCalls: web ? 1 : 0, tariff });
            try {
                await db.aiChatMessage.create({ data: { sessionId, role: "tool", content: "Внешний поиск" + (web ? " подтверждён" : " не используется"), aiUsageLogId: aiUsageLogId(requestId) } });
            }
            catch (error) {
                await gate.release(requestId);
                throw error;
            }
            let result;
            try {
                result = await provider.respond(request);
                await gate.settle(requestId, { outcome: "success", usage: result.usage, webSearchCalls: result.webSearchCalls });
                return result;
            }
            catch (error) {
                await gate.settle(requestId, { outcome: "error", usage: result?.usage, webSearchCalls: result?.webSearchCalls });
                throw error;
            }
        } };
}
