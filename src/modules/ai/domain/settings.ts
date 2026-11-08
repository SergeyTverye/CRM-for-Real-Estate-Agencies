import { z } from "zod";
export const AI_SOURCES = ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"] as const;
const model = z.string().trim().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/).max(160);
const count = z.number().int().min(0).max(100000);
export const aiSettingsInput = z.object({
  expectedUpdatedAt: z.iso.datetime(), aiEnabled: z.boolean(), scraperEnabled: z.boolean(), browserEnabled: z.boolean(),
  cianAutoBrowser: z.boolean().nullable().optional(), yandexAutoBrowser: z.boolean().nullable().optional(),
  enabledSources: z.array(z.enum(AI_SOURCES)).max(7), webSearchManualAllowed: z.boolean(), webSearchAutoFallback: z.boolean(),
  model, webModel: model.nullable(), searchContextSize: z.enum(["low", "medium", "high"]),
  perUserDailyLimit: count, perJobLimit: count, dailyLimit: count,
  monthlyBudgetRub: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  tariffs: z.array(z.object({ model, effectiveFrom: z.iso.datetime(), inputRubPerMillion: z.string().regex(/^\d{1,10}(?:\.\d{1,6})?$/),
    outputRubPerMillion: z.string().regex(/^\d{1,10}(?:\.\d{1,6})?$/), webRubPerCall: z.string().regex(/^\d{1,10}(?:\.\d{1,6})?$/) }).strict()).max(20).optional(),
}).strict();
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;
