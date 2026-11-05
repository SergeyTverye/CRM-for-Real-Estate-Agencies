import type { SourceRun } from "./types";

export interface FallbackPolicy {
  aiEnabled: boolean; webSearchEnabled: boolean; autoFallback: boolean;
  manualAllowed: boolean; budgetAvailable: boolean; limitAvailable: boolean; alreadyAttempted: boolean;
}
export function decideFallback(sources: SourceRun[], policy: FallbackPolicy): { automatic: boolean; manual: boolean; reason: string } {
  if (!policy.aiEnabled) return { automatic: false, manual: false, reason: "ИИ отключён; доступны ручные фильтры" };
  if (!policy.webSearchEnabled) return { automatic: false, manual: false, reason: "Веб-поиск отключён" };
  if (!policy.budgetAvailable || !policy.limitAvailable) return { automatic: false, manual: false, reason: "Бюджет или лимит веб-поиска исчерпан" };
  if (policy.alreadyAttempted) return { automatic: false, manual: false, reason: "Резервный поиск для задания уже запускался" };
  const enabled = sources.filter(s => s.status !== "disabled");
  const failed = new Set(["blocked", "timeout", "unsupported_filter", "error"]);
  const allFailed = enabled.length > 0 && enabled.every(s => failed.has(s.status));
  return { automatic: allFailed && policy.autoFallback, manual: policy.manualAllowed,
    reason: !enabled.length ? "Нет включённых площадок; автоматический переход не требуется" : allFailed ? policy.autoFallback ? "Полный технический отказ: разрешён резервный поиск" : "Автоматический резерв отключён" : "Есть исправный ответ, включая пустой; возможен разрешённый ручной поиск" };
}
