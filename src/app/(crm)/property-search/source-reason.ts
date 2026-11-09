
export function sourceReason(reason: string | null, status: string): string {
  if (!reason) return status === "success" ? "Источник обработан" : status === "disabled" ? "Источник отключён в настройках" : status === "timeout" ? "Площадка не ответила вовремя" : "Площадка не сообщила причину";
  if (/NEEDS_USER_ACTION|SOURCE_CONTINUATION_NOT_ALLOWED/iu.test(reason)) return "Нужна ручная проверка площадки. Откройте её в обычном браузере и добавьте ссылку объявления или официальную выгрузку.";
  return reason.split(/;\s*/u).map(part => {
    if (/ACCESS_BLOCKED|HTTP\s*(?:401|403|429|439)|CAPTCHA/iu.test(part)) {
      const http = part.match(/(?:HTTP\s*|status[=: ]+)(\d{3})/iu)?.[1];
      return `Доступ ограничен площадкой${http ? ` (HTTP ${http})` : ""}`;
    }
    if (/PARSE_FAILED/iu.test(part)) return "Площадка изменила разметку — не удалось разобрать";
    if (/FETCH_FAILED/iu.test(part)) return "Площадка недоступна";
    if (/TIMEOUT/iu.test(part)) return "Площадка не ответила вовремя";
    if (/Выборка ограничена бюджетом/iu.test(part)) return "Проверена часть объявлений: достигнут лимит страниц или результатов";
    if (/^[A-Z_]+(?:\s|$)/u.test(part)) return "Не удалось обработать источник";
    return part;
  }).join("; ");
}
