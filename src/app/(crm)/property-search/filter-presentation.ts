import { FEATURE_DEFINITIONS, type FeatureKey } from "@/modules/property-search/domain/filter-catalog";
import type { Purpose, SearchFilters, Source } from "@/modules/property-search/domain/types";

export type AvailabilityReason =
  | "ready"
  | "disabled_by_settings"
  | "disabled_by_server"
  | "credentials_missing"
  | "credential_store_unavailable"
  | "tariff_unavailable";

export interface SearchRuntimeAvailability {
  scraper: { enabled: boolean; reason: AvailabilityReason };
  browser: { enabled: boolean; configured: boolean };
  sources: { source: Source; enabled: boolean; reason: AvailabilityReason }[];
  ai: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    reason: AvailabilityReason;
    message: string | null;
    settingsUrl: string;
  };
  manualWeb: boolean;
  autoFallback: boolean;
}

export interface SearchDepthState {
  maxPages: number;
  limit: number;
}

export const DEFAULT_SEARCH_DEPTH: SearchDepthState = { maxPages: 2, limit: 100 };
export const DEFAULT_DEADLINE_SECONDS = 180;

export const PURPOSE_LABELS: Record<Purpose, string> = {
  retail: "Торговля",
  psn_universal: "ПСН / универсальное",
  office: "Офис",
  production: "Производство",
  warehouse: "Склад",
  free_purpose: "Свободное назначение",
  residential: "Жилая",
};

export const PURPOSE_HELP: Record<Purpose, string> = {
  retail: "Торговые площади, стрит-ритейл, павильоны и магазины.",
  psn_universal: "Помещения свободного или универсального назначения, подходящие под услуги, торговлю или офис.",
  office: "Офисные блоки, кабинеты и помещения в бизнес-центрах или административных зданиях.",
  production: "Производственные цеха, мастерские и промышленные площадки.",
  warehouse: "Складские комплексы, ангары, логистические и тёплые/холодные склады.",
  free_purpose: "Объекты с явно указанным свободным назначением без узкой специализации.",
  residential: "Жилая недвижимость: квартиры, студии, жилые дома, коттеджи и таунхаусы. При выборе вместе с коммерческими назначениями поиск выполняется по обеим категориям площадок.",
};

export const SOURCE_LABELS: Record<string, string> = {
  cian: "Циан",
  mirkvartir: "Мир Квартир",
  onrealt: "OnRealt",
  domclick: "Домклик",
  yandex: "Яндекс Недвижимость",
  youla: "Юла",
  avito: "Авито",
  web_search: "Веб-резерв",
};

export const SEARCH_HELP = {
  primaryFilters:
    "Основные условия (город, операция, цена, площадь, назначение и площадки) открыты сразу. Дополнительные параметры этажа, районов, коммуникаций и свежести свёрнуты в блок «Расширенные фильтры».",
  priceUnit:
    "Для продажи используется полная цена объекта в рублях. Для аренды выберите расчётную единицу ставки (за месяц, год или за м²), чтобы сравнивать однородные предложения.",
  purposes:
    "Между выбранными назначениями действует логическое ИЛИ: подходят объявления любого из отмеченных типов, включая «Жилая» и коммерческие категории. Если ни одно назначение не отмечено, проверяются коммерческие категории по умолчанию.",
  sources:
    "Отметьте площадки для опроса. Руководитель управляет глобальным включением скрапера, браузерного режима и площадок на странице «Источники поиска» (/settings/sources).",
  advancedFilters:
    "Расширенные фильтры сохраняются и применяются при запуске даже в свёрнутом состоянии. Счётчик показывает число активных дополнительных условий, а кнопка сброса очищает только их.",
  floorMode:
    "Ограничение расположения по этажу: «Строго первый» исключает этажи выше первого и цоколь/подвал; «Без подвала и цоколя» допускает любой надземный этаж.",
  seller:
    "Фильтр по типу продавца. Статус «Только проверенный собственник» требует подтверждения сотрудником агентства в карточке проверки объявления.",
  requiredFeatures:
    "Обязательные признаки через точку с запятой (соединяются по «И»). Если признак не упомянут в объявлении, объект попадает во вкладку «Требуют проверки», а не отбрасывается вслепую.",
  preferredFeatures:
    "Желательные признаки повышают оценку соответствия и ранжирование, но их отсутствие не исключает объявление.",
  catalogFeatures:
    "Структурированные и текстовые характеристики помещения (мощность кВт, высота потолков, отдельный вход, витрина, разгрузка, парковка и др.).",
  freshness:
    "Фильтрация по дате публикации на площадке или первому обнаружению в CRM. Для режима «Опубликовано площадкой» объявления без даты можно включить отдельным блоком.",
  depth:
    "Лимит страниц и объявлений на каждую площадку в рамках одного запуска, а также максимальное общее время ожидания ответа источников.",
  sourceStatus:
    "Показывает фактический ответ каждой площадки: сколько объявлений получено, сколько прошло первичную фильтрацию и нужна ли интерактивная проверка (капча) или ручной импорт.",
  resultVerdicts:
    "«Совпадения» — все обязательные критерии подтверждены; «Требуют проверки» — противоречий нет, но часть признаков не указана площадкой; «Исключены» — найдено явное противоречие условиям.",
} as const;

export function formatPurposeLabel(purpose: string | null | undefined): string {
  if (!purpose) return "Неизвестно";
  return PURPOSE_LABELS[purpose as Purpose] ?? purpose;
}

export function countActiveAdvancedFilters(
  filters: SearchFilters,
  depth: SearchDepthState = DEFAULT_SEARCH_DEPTH,
  deadlineSeconds: number = DEFAULT_DEADLINE_SECONDS,
): number {
  let count = 0;
  if (filters.floorMode !== "any") count += 1;
  if (filters.floorFrom !== undefined || filters.floorTo !== undefined) count += 1;
  if (filters.districts.length > 0) count += 1;
  if (filters.seller !== "all") count += 1;
  if (filters.requiredFeatures.some((item) => item.trim().length > 0)) count += 1;
  if (filters.preferredFeatures.some((item) => item.trim().length > 0)) count += 1;
  if (filters.features) {
    for (const value of Object.values(filters.features)) {
      if (value === undefined) continue;
      if (typeof value === "boolean") count += 1;
      else if (value.min !== undefined || value.max !== undefined) count += 1;
    }
  }
  if (filters.hasPhotos !== undefined) count += 1;
  if (filters.verification && filters.verification !== "all") count += 1;
  if (filters.freshness !== undefined) count += 1;
  if (
    depth.maxPages !== DEFAULT_SEARCH_DEPTH.maxPages ||
    depth.limit !== DEFAULT_SEARCH_DEPTH.limit ||
    deadlineSeconds !== DEFAULT_DEADLINE_SECONDS
  ) {
    count += 1;
  }
  return count;
}

export function summarizeActiveAdvancedFilters(
  filters: SearchFilters,
  depth: SearchDepthState = DEFAULT_SEARCH_DEPTH,
  deadlineSeconds: number = DEFAULT_DEADLINE_SECONDS,
): string[] {
  const badges: string[] = [];
  if (filters.floorMode === "first_floor_only") badges.push("Этаж: строго первый");
  else if (filters.floorMode === "exclude_basement_and_semi_basement") badges.push("Этаж: без подвала и цоколя");
  if (filters.floorFrom !== undefined || filters.floorTo !== undefined) {
    badges.push(`Этаж: ${filters.floorFrom ?? "—"}–${filters.floorTo ?? "—"}`);
  }
  if (filters.districts.length > 0) {
    badges.push(`Районы (${filters.districts.length}): ${filters.districts.slice(0, 3).join(", ")}${filters.districts.length > 3 ? "…" : ""}`);
  }
  if (filters.seller === "confirmed_owner_only") badges.push("Продавец: проверенный собственник");
  else if (filters.seller === "agent") badges.push("Продавец: посредник");

  const req = filters.requiredFeatures.map((s) => s.trim()).filter(Boolean);
  if (req.length > 0) badges.push(`Обязательно: ${req.join("; ")}`);

  const pref = filters.preferredFeatures.map((s) => s.trim()).filter(Boolean);
  if (pref.length > 0) badges.push(`Желательно: ${pref.join("; ")}`);

  if (filters.features) {
    for (const [rawKey, value] of Object.entries(filters.features)) {
      if (value === undefined) continue;
      const def = FEATURE_DEFINITIONS[rawKey as FeatureKey];
      const label = def?.label ?? rawKey;
      if (typeof value === "boolean") {
        badges.push(`${label}: ${value ? "да" : "нет"}`);
      } else if (value.min !== undefined || value.max !== undefined) {
        badges.push(`${label}: ${value.min ?? "—"}–${value.max ?? "—"}`);
      }
    }
  }
  if (filters.hasPhotos !== undefined) {
    badges.push(`Фото: ${filters.hasPhotos ? "есть" : "без фото"}`);
  }
  if (filters.verification === "checked") badges.push("Проверка: проверены сотрудником");
  else if (filters.verification === "unchecked") badges.push("Проверка: не проверены");

  if (filters.freshness) {
    const modeLabel = filters.freshness.mode === "published" ? "публикация" : "обнаружение CRM";
    const periodLabel =
      filters.freshness.period === "24h"
        ? "24 часа"
        : filters.freshness.period === "custom"
          ? `${filters.freshness.from ?? "…"}—${filters.freshness.to ?? "…"}`
          : `${filters.freshness.period} дн.`;
    badges.push(`Свежесть (${modeLabel}): ${periodLabel}`);
  }
  if (
    depth.maxPages !== DEFAULT_SEARCH_DEPTH.maxPages ||
    depth.limit !== DEFAULT_SEARCH_DEPTH.limit ||
    deadlineSeconds !== DEFAULT_DEADLINE_SECONDS
  ) {
    badges.push(`Глубина: ${depth.maxPages} стр. / ${depth.limit} объ. / ${deadlineSeconds} с`);
  }
  return badges;
}

export function resetAdvancedSearchFilters(filters: SearchFilters): SearchFilters {
  const next: SearchFilters = {
    city: filters.city,
    operation: filters.operation,
    ...(filters.priceUnit ? { priceUnit: filters.priceUnit } : {}),
    purposes: [...filters.purposes],
    floorMode: "any",
    ...(filters.priceFrom !== undefined ? { priceFrom: filters.priceFrom } : {}),
    ...(filters.priceTo !== undefined ? { priceTo: filters.priceTo } : {}),
    ...(filters.areaFrom !== undefined ? { areaFrom: filters.areaFrom } : {}),
    ...(filters.areaTo !== undefined ? { areaTo: filters.areaTo } : {}),
    districts: [],
    seller: "all",
    requiredFeatures: [],
    preferredFeatures: [],
    sources: [...filters.sources],
  };
  return next;
}

export function describeAvailabilityReason(reason: AvailabilityReason, subject: "scraper" | "source" | "ai"): string {
  switch (reason) {
    case "ready":
      return subject === "ai" ? "Готов к работе" : subject === "source" ? "Площадка активна" : "Скрапер активен";
    case "disabled_by_settings":
      return subject === "ai"
        ? "Отключён в настройках агентства"
        : subject === "source"
          ? "Отключена в настройках источников"
          : "Скрапер отключён в настройках источников";
    case "disabled_by_server":
      return subject === "ai"
        ? "Отключён конфигурацией сервера (ENV)"
        : "Отключён конфигурацией сервера (ENV)";
    case "credentials_missing":
      return "Требуется подключение Яндекс AI";
    case "credential_store_unavailable":
      return "Защищённое хранилище Яндекс AI недоступно";
    case "tariff_unavailable":
      return "Нет действующего тарифа ИИ";
  }
}

export interface AiAvailabilityPresentation {
  ready: boolean;
  enabledInSettings: boolean;
  configured: boolean;
  reason: AvailabilityReason;
  badgeText: string;
  detailText: string;
  actionLabel: string | null;
  settingsUrl: string;
  tone: "green" | "yellow" | "slate";
}

export function describeAiAvailability(
  availability: SearchRuntimeAvailability | null | undefined,
  fallbackAiEnabled: boolean,
): AiAvailabilityPresentation {
  if (!availability) {
    return fallbackAiEnabled
      ? {
          ready: true,
          enabledInSettings: true,
          configured: true,
          reason: "ready",
          badgeText: "Яндекс AI готов",
          detailText: "Разбор условий, анализ описаний и разрешённый веб-поиск доступны.",
          actionLabel: "Настройки Яндекс AI",
          settingsUrl: "/settings/ai",
          tone: "green",
        }
      : {
          ready: false,
          enabledInSettings: false,
          configured: false,
          reason: "disabled_by_settings",
          badgeText: "ИИ отключён",
          detailText: "ИИ отключён. Используйте ручные фильтры, поиск по площадкам и экспорт.",
          actionLabel: "Настройки Яндекс AI",
          settingsUrl: "/settings/ai",
          tone: "slate",
        };
  }

  const { ai } = availability;
  switch (ai.reason) {
    case "credentials_missing":
      return {
        ready: false,
        enabledInSettings: true,
        configured: false,
        reason: "credentials_missing",
        badgeText: ai.message ?? "Требуется подключение Яндекс AI",
        detailText:
          "Требуется подключение Яндекс AI: режим ИИ включён в настройках, но ключ API или каталог не заданы. Поиск по площадкам и ручные фильтры работают штатно.",
        actionLabel: "Подключить Яндекс AI",
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "yellow",
      };
    case "credential_store_unavailable":
      return {
        ready: false,
        enabledInSettings: true,
        configured: false,
        reason: "credential_store_unavailable",
        badgeText: ai.message ?? "Защищённое хранилище Яндекс AI недоступно",
        detailText:
          "Защищённое хранилище Яндекс AI недоступно. Проверьте параметры подключения на странице настроек ИИ; поиск по площадкам и ручные фильтры доступны.",
        actionLabel: "Проверить подключение Яндекс AI",
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "yellow",
      };
    case "tariff_unavailable": {
      const baseMessage =
        ai.message ??
        "Для выбранной модели ИИ нет действующего полного тарифа. Руководителю: добавьте тариф или выберите модель с действующим тарифом в настройках ИИ.";
      return {
        ready: false,
        enabledInSettings: true,
        configured: ai.configured,
        reason: "tariff_unavailable",
        badgeText: "Нет действующего тарифа ИИ",
        detailText: `${baseMessage} Поиск по площадкам и ручные фильтры работают штатно без подтверждения оплаты.`,
        actionLabel: "Настроить тарифы ИИ",
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "yellow",
      };
    }
    case "disabled_by_server":
      return {
        ready: false,
        enabledInSettings: false,
        configured: ai.configured,
        reason: "disabled_by_server",
        badgeText: "ИИ отключён на сервере (ENV)",
        detailText: "ИИ отключён серверным ограничением (AI_ENABLED=false). Используйте ручные фильтры.",
        actionLabel: null,
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "slate",
      };
    case "disabled_by_settings":
      return {
        ready: false,
        enabledInSettings: false,
        configured: ai.configured,
        reason: "disabled_by_settings",
        badgeText: "ИИ отключён в настройках",
        detailText: "ИИ отключён. Используйте ручные фильтры.",
        actionLabel: "Настройки Яндекс AI",
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "slate",
      };
    case "ready":
      return {
        ready: true,
        enabledInSettings: true,
        configured: true,
        reason: "ready",
        badgeText: "Яндекс AI подключён",
        detailText: "Разбор запроса, проверка описаний и разрешённый веб-поиск готовы к работе.",
        actionLabel: "Настройки Яндекс AI",
        settingsUrl: ai.settingsUrl || "/settings/ai",
        tone: "green",
      };
  }
}
