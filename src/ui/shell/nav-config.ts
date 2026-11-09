export interface NavItem {
  href: string;
  label: string;
  managerOnly?: boolean;
}


export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Сегодня" },
  { href: "/requests", label: "Обращения" },
  { href: "/clients", label: "Клиенты" },
  { href: "/needs", label: "Потребности" },
  { href: "/properties", label: "Объекты" },
  { href: "/property-search", label: "Поиск объектов" },
  { href: "/collections", label: "Подборки" },
  { href: "/showings", label: "Показы" },
  { href: "/tasks", label: "Задачи" },
  { href: "/calendar", label: "Календарь" },
  { href: "/notifications", label: "Уведомления" },
  { href: "/offers", label: "Предложения" },
  { href: "/deals", label: "Сделки" },
  { href: "/agreements", label: "Договоры" },
  { href: "/advertisements", label: "Реклама" },
  { href: "/reports", label: "Отчёты", managerOnly: true },
  { href: "/archive", label: "Архив сделок", managerOnly: true },
  { href: "/import", label: "Импорт", managerOnly: true },
  { href: "/operations", label: "Эксплуатация", managerOnly: true },
  { href: "/admin", label: "Администрирование", managerOnly: true },
  { href: "/templates", label: "Шаблоны документов", managerOnly: true },
  { href: "/settings/backups", label: "Резервные копии", managerOnly: true },
  { href: "/settings/sources", label: "Источники поиска", managerOnly: true },
  { href: "/settings/ai", label: "Настройки ИИ", managerOnly: true },
];


export const CREATE_ITEMS: { href: string; label: string }[] = [
  { href: "/requests/new", label: "Обращение" },
  { href: "/clients/new", label: "Клиент" },
  { href: "/needs/new", label: "Потребность" },
  { href: "/properties/new", label: "Объект" },
  { href: "/showings/new", label: "Показ" },
  { href: "/tasks/new", label: "Задача" },
  { href: "/deals/new", label: "Сделка" },
];
