import { z } from "zod";

export const contextSchema = z.object({
  kind: z.enum(["none", "client", "need", "collection", "task", "deal", "agreement", "today", "reports"]),
  id: z.uuid().optional(),
}).strict().refine(c => ["none", "today", "reports"].includes(c.kind) ? !c.id : !!c.id);
export type ChatContext = z.infer<typeof contextSchema>;
const routeKinds = { clients: "client", needs: "need", collections: "collection", tasks: "task", deals: "deal", agreements: "agreement" } as const;
export function pageContext(path: string): ChatContext {
  const m = path.match(/^\/(clients|needs|collections|tasks|deals|agreements)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
  if (m) return { kind: routeKinds[m[1]!.toLowerCase() as keyof typeof routeKinds], id: m[2] };
  if (path === "/today") return { kind: "today" };
  if (/^\/reports(?:\/|$)/.test(path)) return { kind: "reports" };
  return { kind: "none" };
}
export const contextLabels: Record<ChatContext["kind"], string> = { none: "общий", client: "клиент", need: "потребность", collection: "подборка", task: "задача", deal: "сделка", agreement: "договор", today: "Сегодня", reports: "отчёты за последние 30 дней" };
export function quickQuestions(kind: ChatContext["kind"]): string[] {
  switch (kind) {
    case "client": case "need": return ["Какое следующее действие и что уточнить у клиента?", "Подготовь черновик сообщения клиенту без отправки", "Какие есть риски сроков?"];
    case "task": return ["Как выполнить эту задачу и что проверить?", "Какие связанные записи нужно открыть?", "Какие есть риски сроков?"];
    case "deal": return ["Что проверить по чек-листу сделки?", "Какие сроки сделки требуют внимания?", "Что уточнить у участников сделки?"];
    case "agreement": return ["Какие сроки договора требуют внимания?", "Что проверить перед следующим действием?"];
    case "today": return ["С чего начать сегодня: просрочки и приоритеты?", "Какие ближайшие задачи требуют внимания?"];
    case "reports": return ["Какие показатели требуют внимания руководителя?", "Какие первичные записи стоит проверить?"];
    default: return ["Какие мои задачи требуют внимания?", "Как подготовиться к следующему контакту?"];
  }
}

export function taskFormHref(context: ChatContext) {
  const param = { client: "clientId", need: "needId", deal: "dealId", agreement: "agreementId" }[context.kind as "client" | "need" | "deal" | "agreement"];
  return context.id && param ? `/tasks/new?${new URLSearchParams({ [param]: context.id })}` : "/tasks/new";
}
