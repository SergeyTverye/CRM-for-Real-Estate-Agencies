import type { Code } from "@/shared/codebook";

/**
 * Шаблоны постсделочных задач (ТЗ 6.5, 19.6, 25.4): налоговая декларация, пересмотр арендной платы /
 * доп. соглашение, счёт, акт, возврат помещения, последующий контакт. Интерфейс предлагает
 * применимые шаблоны при закрытии сделки. ответственный по умолчанию — руководитель.
 */
export interface PostdealTemplate {
  subtypeCode: Code<"postdealSubtype">;
  title: string;
  offsetDays: number;
  recurrenceKind?: Code<"recurrenceKind">;
}

export function postdealTemplatesFor(operationType: string): PostdealTemplate[] {
  const common: PostdealTemplate[] = [
    { subtypeCode: "other", title: "Сверка расчётов по сделке", offsetDays: 3 },
    { subtypeCode: "other", title: "Контроль сроков договоров / допсоглашений", offsetDays: 30 },
    { subtypeCode: "other", title: "Страхование (при применимости)", offsetDays: 30 },
  ];
  if (operationType === "rent") {
    return [
      ...common,
      { subtypeCode: "acceptance_act", title: "Подписать акт приёма-передачи помещения", offsetDays: 1 },
      { subtypeCode: "invoice", title: "Выставить счёт по комиссии", offsetDays: 3 },
      { subtypeCode: "rent_indexation", title: "Пересмотр арендной платы / доп. соглашение", offsetDays: 335, recurrenceKind: "yearly" },
      { subtypeCode: "premises_return", title: "Продление аренды / контроль возврата помещения", offsetDays: 365 },
      { subtypeCode: "followup", title: "Связаться с клиентом после сделки", offsetDays: 30 },
    ];
  }
  return [
    ...common,
    { subtypeCode: "acceptance_act", title: "Подписать акт по сделке", offsetDays: 3 },
    { subtypeCode: "invoice", title: "Выставить счёт по комиссии", offsetDays: 3 },
    { subtypeCode: "tax_declaration", title: "Напомнить клиенту о налоговой декларации", offsetDays: 120 },
    { subtypeCode: "followup", title: "Связаться с клиентом после сделки", offsetDays: 30 },
  ];
}
