import type { Tone } from "@/ui/components";



export const ROW_CODE_LABELS: Record<string, string> = {
  
  policy_fields_excluded: "В строке были поля, исключённые политикой (значения не загружаются)",
  section_needs_mapping: "Секция не распознана — нужен mapping",
  comment_or_separator: "Строка-комментарий или разделитель",
  unresolved_fields_ignored: "Неоднозначные поля (ОВ/ЗУ/А) не импортируются",
  
  missing_required: "Нет ни адреса/объекта, ни участника",
  missing_address: "Не указан адрес",
  missing_name: "Не указано имя клиента",
  unknown_type_or_operation: "Не определены тип объекта или операция",
  unknown_function: "Не распознана «Функция» (операция клиента)",
  invalid_date: "Некорректная дата сделки",
  invalid_received_date: "Некорректная дата поступления",
  invalid_phone: "Некорректный телефон",
  invalid_price: "Некорректная цена/стоимость",
  invalid_area: "Некорректная площадь",
  invalid_commission: "Некорректная сумма комиссии",
  invalid_url: "Некорректная ссылка",
  owner_ambiguous: "Собственник не распознан однозначно",
  no_contact: "Нет контакта (поле «Координаты» пусто)",
  phone_removed_from_description: "Телефон удалён из описания",
  ambiguous_agreement_presence: "Неоднозначное значение «Наличие договора»",
  
  probable_duplicate: "Вероятный дубль",
  already_imported: "Уже загружено ранее",
  unrecognized: "Не распознано",
  commit_failed: "Ошибка записи в CRM",
  VALIDATION_ERROR: "Ошибка проверки данных при записи",
  NEXT_ACTION_REQUIRED: "Потребности нужно следующее действие",
  RETURN_TASK_REQUIRED: "Потребности на паузе нужна задача возврата",
  STOP_REASON_REQUIRED: "Закрытой потребности нужна причина",
  P2002: "Нарушение уникальности при записи",
  P2003: "Нарушение связи между записями",
};

export const rowCodeLabel = (code: string) => ROW_CODE_LABELS[code] ?? code;


export const MAPPING_FIELD_LABELS: Record<string, string> = {
  sourceRowId: "№ записи источника",
  dealDate: "Дата сделки",
  dealYear: "Год сделки",
  dealMonth: "Месяц сделки",
  dealDay: "День сделки",
  propertyType: "Тип объекта",
  objectText: "Адрес / объект",
  roomsOrType: "Комнаты / тип помещения (в описание объекта)",
  partyRole: "Роль участника сделки",
  participantName: "ФИО участника",
  contactPhone: "Телефон",
  floor: "Этаж",
  floorsTotal: "Этажность",
  area: "Площадь",
  extra: "Доп. характеристики (в описание объекта)",
  price: "Цена / стоимость",
  conditions: "Условия продажи",
  realtorText: "Риелтор (текст)",
  contractRef: "Информационный договор",
  commissionAmount: "Сумма комиссии",
  commissionReceived: "Фактическое поступление (в доп. информацию)",
  additionalInfo: "Доп. информация",
  addressText: "Адрес",
  district: "Район",
  roomsCount: "Количество комнат",
  commercialPurpose: "Назначение",
  propertyTypeText: "Тип объекта (текст → код)",
  operationText: "Операция (текст → код)",
  description: "Описание",
  adText: "Рекламный текст",
  adUrl: "Ссылка на объявление",
  adPlatformText: "Рекламная площадка",
  ownerName: "Собственник — имя",
  ownerPhone: "Собственник — телефон",
  listedDate: "Дата",
  receivedDate: "Дата поступления → дата обращения",
  updatedDate: "Дата обновления → последняя активность",
  stateMark: "Отметка о состоянии → статус потребности",
  functionText: "Функция → операция клиента",
  name: "Имя клиента",
  coordinates: "Координаты (исходный контакт)",
  comment: "Комментарий",
  actuality: "Актуальность",
  taskText: "Задача",
  agreementPresence: "Наличие договора",
  absenceReason: "Причина отсутствия договора",
  commissionFrom: "Комиссия от",
  commissionTo: "Комиссия до",
  fixNote: "Что нужно исправить",
};


export const PREVIEW_FIELD_LABELS: Record<string, string> = {
  ...MAPPING_FIELD_LABELS,
  dealDateText: "Дата (как в файле)",
  contactEmail: "E-mail",
  operationType: "Операция",
  sourceType: "Источник объекта",
  sourceUrl: "Ссылка-источник",
  owner: "Собственник",
  receivedAt: "Дата поступления",
  lastActivityAt: "Дата обновления",
  needStatus: "Статус потребности",
  coordinatesRaw: "Координаты",
  coordinatesKind: "Тип координат",
  coordinatesNormalized: "Нормализованный контакт",
  channelCode: "Канал",
  sourceCode: "Источник",
  agreementPresent: "Договор есть",
};


export const PREVIEW_PRIMARY: Record<string, string[]> = {
  historical_deal_archive: ["dealDateText", "objectText", "participantName", "price"],
  property: ["addressText", "area", "price"],
  client_request_need: ["name", "coordinatesRaw", "operationType", "receivedAt"],
  property_agreement_control: ["addressText", "agreementPresent", "fixNote"],
};

export const TARGET_LABELS: Record<string, string> = {
  historical_deal_archive: "Исторический архив сделок (только чтение)",
  property: "Объекты; реклама и собственник — если распознаны",
  client_request_need: "Клиенты, обращения и потребности",
  property_agreement_control: "Объекты, договоры, реклама и (по выбору) задачи",
};

export const JOB_STATUS_TONES: Record<string, Tone> = {
  uploaded: "gray",
  parsing: "blue",
  dry_run_ready: "blue",
  dry_run_failed: "red",
  committing: "blue",
  completed: "green",
  completed_with_errors: "yellow",
  failed: "red",
  cancelled: "gray",
};

export const VALIDATION_TONES: Record<string, Tone> = {
  ready: "green",
  warning: "yellow",
  skipped_policy: "gray",
  invalid: "red",
  unrecognized: "gray",
};

export const COMMIT_TONES: Record<string, Tone> = { imported: "green", skipped: "gray", error: "red" };

export const VALIDATION_STATUS_ORDER = ["ready", "warning", "skipped_policy", "invalid", "unrecognized"] as const;
