export function dealChecklistTemplate(operation: string) {
  return [
    ["title", operation === "rent" ? "Основание права арендодателя" : "Правоустанавливающие материалы"],
    ["technical", "Технические материалы"], ["egrn", "Выписка ЕГРН"], ["encumbrances", "Обременения"],
    ["signatory", "Полномочия подписанта"], ["entity", "Сведения юридического лица / ИП"],
    ["agreement", operation === "rent" ? "Договор аренды" : "Договор купли-продажи"],
    ["act", "Акт"], ["invoice", "Счёт"],
  ].map(([code, title], sortOrder) => ({ code: code!, title: title!, sortOrder }));
}
