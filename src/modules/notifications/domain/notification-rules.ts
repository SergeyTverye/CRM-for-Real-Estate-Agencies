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

/** Titles are static: imported task titles may themselves contain a foreign client's PII. */
export const NOTIFICATION_TITLES: Record<string, string> = {
  task: "Срок задачи", assignment: "Вам назначена задача", showing: "Запланирован показ",
  agreement: "Контроль срока договора", pause_return: "Вернуться к потребности из паузы",
  annual_contact: "Ежегодный контакт", postdeal: "Постсделочный контакт", calendar_event: "Запланирована встреча",
};
