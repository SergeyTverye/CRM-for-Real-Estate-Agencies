import type { Actor } from "@/modules/auth/domain/actor";
import { getAiLimits } from "@/modules/ai/application/settings-service";
import { effectiveLimits, periodKeys } from "@/modules/ai/domain/gate";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { microsToRub, PrismaAiLedger, PrismaAiSettings } from "@/modules/ai/infrastructure/prisma-repositories";
import { getConfig } from "@/shared/config/env";


export async function getSearchAiLimits(actor: Actor) {
  const config = getConfig();
  const [limits, settings] = await Promise.all([getAiLimits(actor), new PrismaAiSettings().getLimits()]);
  const effective = effectiveLimits(envAiLimits(config), settings);
  const now = new Date();
  const usage = await new PrismaAiLedger().atomic(tx => tx.usage({ userId: actor.userId,
    jobId: "00000000-0000-4000-8000-000000000000", hourSince: new Date(+now - 3600000), ...periodKeys(now, config.APP_TIMEZONE) }));
  const available = effective.monthlyBudgetMicros > usage.monthCommittedMicros ? effective.monthlyBudgetMicros - usage.monthCommittedMicros : 0n;
  return { ...limits, budgetAvailable: available > 0n, remaining: { ...limits.remaining, monthlyBudgetRub: microsToRub(available) } };
}
