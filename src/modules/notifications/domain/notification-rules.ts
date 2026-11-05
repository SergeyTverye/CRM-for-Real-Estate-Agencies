export function taskNotificationKind(task: { taskType: string; recurrenceKind: string }): "task" | "pause_return" | "annual_contact" | "postdeal" {
  if (task.taskType === "pause_return") return "pause_return";
  if (task.taskType === "postdeal") return "postdeal";
  if (task.recurrenceKind === "yearly") return "annual_contact";
  return "task";
}

export function reminderAt(dueAt: Date, leadMinutes: number) {
  return new Date(+dueAt - leadMinutes * 60000);
}

export function notificationKey(recipient: string, sourceType: string, sourceId: string, kind: string, occurrence: Date) {
  return `${recipient}:${sourceType}:${sourceId}:${kind}:${occurrence.toISOString()}`;
}

/** Context is supplied only after checking every linked client at read time. */
export const NOTIFICATION_TITLES: Record<string, string> = {
  task: "Срок задачи", assignment: "Вам назначена задача", showing: "Запланирован показ",
  agreement: "Контроль срока договора", pause_return: "Вернуться к потребности из паузы",
  annual_contact: "Ежегодный контакт", postdeal: "Постсделочный контакт", calendar_event: "Запланирована встреча",
};

export function notificationText(kind: string, context: { title?: string | null; client?: string | null; property?: string | null; at?: string | null; end?: string | null }, timeZone: string) {
  const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  const title = [NOTIFICATION_TITLES[kind] ?? "Напоминание", context.title, context.client, context.property].filter(Boolean).join(" · ");
  const detail = context.at ? `${kind === "agreement" ? "Срок договора" : kind === "calendar_event" || kind === "showing" ? "Когда" : "Срок"}: ${date(context.at)}${context.end ? ` — ${date(context.end)}` : ""}` : "";
  return { title, detail };
}

/** Presentation grouping never merges source records or changes unread counts. */
export function groupNotifications<T extends { id: string; kind: string; triggerAt: string }>(items: T[], timeZone: string) {
  const groups = new Map<string, { key: string; day: string; label: string; items: T[] }>();
  for (const item of items) {
    const day = new Intl.DateTimeFormat("ru-RU", { timeZone, dateStyle: "long" }).format(new Date(item.triggerAt));
    const key = `${day}:${item.kind}`;
    const group = groups.get(key) ?? { key, day, label: NOTIFICATION_TITLES[item.kind] ?? "Напоминания", items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return [...groups.values()];
}
