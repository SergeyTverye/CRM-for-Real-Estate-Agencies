import { labelOf } from "@/shared/codebook";
const labels: Record<string, string> = {
  newRequests: "Новые обращения", unprocessedRequests: "Обращения без обработки", activeNeeds: "Активные потребности",
  activeWithNextAction: "Потребности со следующим действием", withoutNextAction: "Потребности без следующего действия", staleNeeds: "Потребности без движения",
  showings: "Показы", overdue: "Просроченные действия", openTasks: "Открытые задачи", dealsOpened: "Открытые сделки",
  dealsActive: "Сделки в работе", dealsCompleted: "Завершённые сделки", reactivated: "Повторно активированные клиенты",
  requestsWithNeed: "Потребности из обращений", requestToShowing: "Потребности с показом после обращения",
  offersSent: "Отправленные КП", offersToShowing: "КП с последующим показом", offersToDeal: "КП с последующей сделкой",
  prospective: "Открытые перспективные обращения", prospectiveWithAction: "Перспективные обращения с действием",
  prospectiveWithoutAction: "Перспективные обращения без действия", contactsCompleted: "Завершённые контакты", contactsOnTime: "Контакты в срок", commissions: "Полученные комиссии",
};
const activities: Record<string, string> = { requests: "Обращения", communications: "Коммуникации", showingsCompleted: "Проведённые показы", tasksCompleted: "Выполненные задачи", dealsOpened: "Открытые сделки", overdue: "Просроченные задачи" };
export function metricTitle(metric: string, dictionaryLabel: (category: "lead_source" | "lead_channel", code: string) => string, employeeLabel: (id: string) => string): string {
  if (labels[metric]) return labels[metric];
  const [group, code = "", activity = ""] = metric.split(":");
  switch (group) {
    case "source": return `Обращения · ${dictionaryLabel("lead_source", code)}`;
    case "channel": return `Обращения · ${dictionaryLabel("lead_channel", code)}`;
    case "showingStatus": return `Показы · ${labelOf("showingStatus", code)}`;
    case "showingResult": return `Результат показов · ${code === "—" ? "Не указан" : labelOf("showingResult", code)}`;
    case "closure": return `Причина закрытия · ${code === "—" ? "Не указана" : labelOf("stopReason", code)}`;
    case "activity": return `${activities[activity] ?? "Активность"} · ${employeeLabel(code)}`;
    default: return "Детализация отчёта";
  }
}
