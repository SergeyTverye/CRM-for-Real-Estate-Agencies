import { formatDate, formatDateTime } from "@/shared/time";

export const modelTimeInstructions = "Все даты и время контекста уже представлены в часовом поясе приложения. В ответе используй только эти значения и переданное now (сейчас), не переводи их в UTC или иной пояс. Календарные даты не сдвигай. Для аргументов API dueAt преобразуй согласованный срок в ISO с явным смещением.";


export function modelTimeData(value: unknown, timeZone = "Asia/Novosibirsk"): unknown {
  if (value instanceof Date) return `${formatDateTime(value, timeZone)} (${timeZone})`;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
      return `${formatDateTime(value, timeZone)} (${timeZone})`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)))
      return `${formatDate(value, timeZone)} (календарная дата, ${timeZone})`;
  }
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") return modelTimeData(value.toJSON(), timeZone);
  if (Array.isArray(value)) return value.map(item => modelTimeData(item, timeZone));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, modelTimeData(item, timeZone)]));
  return value;
}
