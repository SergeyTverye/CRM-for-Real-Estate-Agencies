

export const CODEBOOK = {
  listingDateSource: { site_published: "Публикация площадки", site_updated: "Обновление площадки", relative_label: "Относительная подпись", first_seen: "Первое обнаружение", unknown: "Неизвестно" },
  listingDatePrecision: { exact: "Точный момент", day: "День", relative: "Относительная дата", unknown: "Неизвестно" },
  pricePerM2Unit: { per_m2: "За м²", per_m2_month: "За м² в месяц", per_m2_year: "За м² в год" },
  browserSessionStatus: { pending: "Ожидает", active: "Активна", completed: "Завершена", cancelled: "Отменена", expired: "Истекла", failed: "Ошибка" },
  duplicateGroupStatus: { auto_exact: "Точное совпадение", probable: "Вероятное совпадение", confirmed: "Подтверждено", rejected: "Разные помещения", deferred: "Решить позже" },
  duplicateDecision: { confirm: "Подтвердить", different: "Разные помещения", defer: "Решить позже", split: "Разъединить" },
  taskChecklistStatus: { open: "Открыт", done: "Выполнен", cancelled: "Отменён" },
  callOutcome: { spam: "Спам", wrong: "Ошибочный звонок", one_time: "Разовый звонок", prospective: "Перспективный звонок" },
  collectionVisibility: { private: "Личная", team: "Командная" },
  collectionItemStatus: { in_collection: "В подборке", check: "Проверить", in_crm: "В базе CRM", proposed: "Предложено клиенту", excluded: "Исключено" },
  templateFormat: { markdown_docx: "Markdown → DOCX", docx: "DOCX", xlsx: "XLSX", xlsx_registry: "XLSX-реестр" },
  templateStatus: { active: "Активен", disabled: "Отключён", archived: "В архиве" },
  aiChatContextType: { client: "Клиент", need: "Потребность", collection: "Подборка", task: "Задача", deal: "Сделка", agreement: "Договор", today: "Сегодня", reports: "Отчёты", none: "Без контекста" },
  aiChatRole: { user: "Пользователь", assistant: "Помощник", tool: "Инструмент" },
  aiPendingActionStatus: { proposed: "Предложено", confirmed: "Подтверждено", rejected: "Отклонено", expired: "Истекло" },
  searchExportFormat: { xlsx: "XLSX", csv: "CSV" },
  searchExportScope: { all_filtered: "Весь отфильтрованный набор", selected: "Выбранные строки" },
  externalSource: { cian: "Циан", mirkvartir: "Мир Квартир", onrealt: "OnRealt", domclick: "Домклик", yandex: "Яндекс Недвижимость", youla: "Юла", avito: "Авито", web_search: "Веб-поиск", manual: "Ручное добавление" },
  externalSourceMethod: { scraper: "Скрапер", web_search: "Веб-поиск", manual: "Вручную" },
  externalOperation: { sale: "Продажа", rent: "Аренда" },
  externalPriceUnit: { total: "Всего", per_month: "В месяц", per_m2: "За м²", per_m2_month: "За м² в месяц", per_year: "В год", per_m2_year: "За м² в год" },
  listingAvailability: { available: "Доступен", reserved: "Забронирован", withdrawn: "Снят", unknown: "Неизвестно" },
  searchBookmarkStatus: { study: "Изучить", clarify: "Уточнить", exclude: "Исключить" },
  selectionReviewStatus: { candidate: "Кандидат", shortlisted: "Отобран", rejected: "Отклонён", proposed: "Предложен" },
  searchRunStatus: { queued: "В очереди", needs_user_action: "Требуется действие", completed: "Завершён", failed: "Ошибка выполнения", pending: "Ожидает", running: "Выполняется", success: "Успешно", partial: "Частично", error: "Ошибка", cancelled: "Отменён" },
  searchSourceStatus: { queued: "В очереди", running: "Выполняется", needs_user_action: "Требуется действие", completed: "Завершён", failed: "Ошибка выполнения", cancelled: "Отменён", success: "Успешно", partial: "Частично", blocked: "Заблокирован", timeout: "Тайм-аут", unsupported_filter: "Фильтр не поддерживается", error: "Ошибка", disabled: "Отключён" },
  searchVerdict: { confirmed: "Совпадает", needs_review: "Требует проверки", rejected: "Исключено" },
  aiCallType: { chat: "AI-чат", chat_web: "Веб-поиск из чата", call_note: "Разбор заметки", offer_text: "Текст КП", parse: "Разбор запроса", description: "Анализ описания", web_search: "Веб-поиск" },
  aiUsageStatus: { pending: "Ожидает", running: "Выполняется", success: "Успешно", error: "Ошибка", cancelled: "Отменён" },
  aiReservationStatus: { reserved: "Зарезервировано", settled: "Учтено", released: "Освобождено" },
  aiSearchContextSize: { low: "Малый", medium: "Средний", high: "Большой" },
  aiTariffUnit: { input_token: "Входной токен", output_token: "Выходной токен", input_million_tokens: "Миллион входных токенов", output_million_tokens: "Миллион выходных токенов", web_search_call: "Веб-запрос" },
  calendarVisibility: { public: "Общее", private: "Личное" },
  notificationState: { pending: "Ожидает", delivered: "Доставлено", read: "Прочитано", dismissed: "Скрыто" },
  notificationKind: { task: "Задача", assignment: "Назначение", showing: "Показ", agreement: "Договор", pause_return: "Возврат из паузы", annual_contact: "Ежегодный контакт", postdeal: "Постсделочный контакт", calendar_event: "Встреча" },
  notificationSourceType: { task: "Задача", showing: "Показ", agreement: "Договор", calendar_event: "Встреча" },
  propertyMediaKind: { photo: "Фото", document: "Документ" },
  dealChecklistStatus: { none: "Нет", review: "На проверке", verified: "Проверено", not_required: "Не требуется" },

  userRole: { manager: "Руководитель", realtor: "Риелтор" },

  clientStatus: { active: "Активный", inactive: "Неактивный", archived: "В архиве" },
  clientKind: { person: "Физическое лицо", organization: "Организация" },
  contactType: { phone: "Телефон", email: "E-mail", other: "Другое" },

  needStatus: { active: "В работе", paused: "На паузе", success: "Успешно завершена", closed: "Закрыта" },
  needStage: {
    new: "Новая",
    qualification: "Квалификация",
    selection: "Подбор",
    showing: "Показы",
    negotiation: "Переговоры",
    preliminary_agreement: "Предварительное соглашение",
    documents: "Документы",
    deal: "Сделка",
    postdeal: "Постсделочное сопровождение",
  },
  stopReason: {
    no_match: "Нет подходящих вариантов",
    budget: "Бюджет",
    no_contact: "Нет связи с клиентом",
    client_refused: "Клиент отказался",
    chose_other: "Выбрал другой вариант/агентство",
    no_longer_relevant: "Потребность неактуальна",
    duplicate_or_error: "Дубль или ошибка",
    other: "Другое (с комментарием)",
  },
  financingType: {
    own_funds: "Собственные средства",
    mortgage: "Ипотека",
    mixed: "Смешанное",
    other: "Другое",
    unknown: "Неизвестно",
  },
  mortgageStatus: {
    not_applicable: "Не применимо",
    not_started: "Не начата",
    in_progress: "В процессе",
    approved: "Одобрена",
    rejected: "Отказ",
    unknown: "Неизвестно",
  },

  leadResult: {
    new_need: "Новая потребность",
    linked_existing_need: "Связано с текущей потребностью",
    one_off_service: "Разовая услуга/консультация",
    no_followup: "Без продолжения",
    invalid_or_spam: "Ошибочное/спам",
  },
  leadStatus: { open: "Открыто", processed: "Обработано", closed: "Закрыто" },

  propertySourceType: { agency_listing: "Объект агентства", external_market: "Внешний рынок" },
  propertyStatus: { draft: "Черновик", active: "Активен", paused: "Приостановлен", closed: "Закрыт", archived: "В архиве" },

  agreementStatus: {
    draft: "Черновик",
    negotiating: "Согласование",
    signed: "Подписан",
    expired: "Истёк",
    terminated: "Расторгнут",
    declined: "Отказ",
    no_agreement: "Договора нет",
    archived: "В архиве",
  },
  agreementType: {
    information: "Информационный",
    exclusive: "Эксклюзивный",
    representation: "Представительство",
    lease_related: "По аренде",
    sale_related: "По продаже",
    other: "Другое",
  },

  showingStatus: { planned: "Запланирован", completed: "Проведён", cancelled: "Отменён", no_show: "Неявка" },
  showingResult: { interested: "Заинтересован", thinking: "Думает", rejected: "Отказ", negotiation: "Переговоры", other: "Другое" },

  taskStatus: { planned: "Запланирована", in_progress: "В работе", completed: "Выполнена", cancelled: "Отменена" },
  taskPriority: { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критический" },
  taskType: {
    pause_return: "Возврат из паузы",
    call_or_contact: "Звонок/контакт",
    showing_or_meeting: "Показ/встреча",
    commercial_offer: "Коммерческое предложение",
    document: "Документ",
    advertising_check: "Проверка рекламы",
    contract_check: "Проверка договора",
    postdeal: "Постсделочное действие",
    other: "Прочее",
  },
  postdealSubtype: {
    tax_declaration: "Налоговая декларация",
    rent_indexation: "Пересмотр арендной платы / доп. соглашение",
    invoice: "Счёт",
    acceptance_act: "Акт",
    premises_return: "Возврат помещения",
    followup: "Последующий контакт",
    other: "Другое",
  },
  recurrenceKind: { none: "Без повтора", daily: "Ежедневно", weekly: "Еженедельно", monthly: "Ежемесячно", yearly: "Ежегодно" },

  dealStatus: {
    draft: "Черновик",
    preliminary_agreement: "Предварительный договор",
    documents: "Документы",
    registration: "Регистрация",
    completed: "Завершена",
    cancelled: "Отменена",
  },
  dealPartyRole: { buyer: "Покупатель", seller: "Продавец", tenant: "Арендатор", landlord: "Арендодатель", other: "Другое" },
  commissionStatus: {
    planned: "Запланирована",
    due: "К оплате",
    partially_received: "Получена частично",
    received: "Получена",
    waived: "Отказ от комиссии",
    cancelled: "Отменена",
  },

  advertisementStatus: { draft: "Черновик", active: "Активно", paused: "Приостановлено", expired: "Истекло", removed: "Снято" },

  offerStatus: {
    draft: "Черновик",
    prepared: "Подготовлено",
    sent: "Отправлено",
    accepted: "Принято",
    rejected: "Отклонено",
    expired: "Истекло",
    archived: "В архиве",
  },
  offerGenerationSource: { manual: "Вручную", template: "По шаблону", ai_assisted: "С помощью AI" },

  matchStatus: {
    proposed: "Предложен",
    interested: "Интересен",
    rejected: "Отклонён",
    showing_planned: "Назначен показ",
    withdrawn: "Снят",
  },

  communicationType: { call: "Звонок", message: "Сообщение", email: "Письмо", meeting: "Встреча", other: "Другое" },
  communicationResult: {
    completed: "Состоялся",
    no_answer: "Нет ответа",
    followup_required: "Нужно продолжение",
    client_refused: "Клиент отказался",
    other: "Другое",
  },

  documentType: {
    agreement: "Договор",
    agreement_addendum: "Дополнительное соглашение",
    agreement_attachment: "Приложение к договору",
    title_document: "Правоустанавливающий документ",
    commercial_offer: "Коммерческое предложение",
    act: "Акт",
    invoice: "Счёт",
    photo: "Фото",
    other: "Другое",
  },
  legalEntityType: { IP: "ИП", LLC: "ООО" },

  importJobStatus: {
    uploaded: "Загружен",
    parsing: "Разбор",
    dry_run_ready: "Проверка готова",
    dry_run_failed: "Проверка не удалась",
    committing: "Загрузка",
    completed: "Завершён",
    completed_with_errors: "Завершён с ошибками",
    failed: "Ошибка",
    cancelled: "Отменён",
  },
  importValidationStatus: {
    ready: "Готово",
    warning: "Предупреждение",
    skipped_policy: "Исключено политикой",
    invalid: "Ошибка",
    unrecognized: "Не распознано",
  },
  importCommitResult: { imported: "Загружено", skipped: "Пропущено", error: "Ошибка" },

  backupTriggerType: {
    scheduled: "По расписанию",
    manual: "Вручную",
    pre_update: "Перед обновлением",
    pre_migration: "Перед миграцией",
    shutdown: "При завершении",
  },
  backupLocalStatus: { pending: "Ожидает", running: "Выполняется", success: "Успешно", failed: "Ошибка" },
  backupUploadStatus: { pending: "Ожидает", uploading: "Загрузка", uploaded: "Загружено", failed: "Ошибка", skipped: "Пропущено" },
  backupVerifyStatus: { not_verified: "Не проверено", verifying: "Проверка", verified: "Проверено", failed: "Ошибка" },
  backupProviderType: {
    yandex_s3: "Yandex Cloud Object Storage",
    mailru_webdav: "Облако Mail.ru (WebDAV)",
    sberdisk_compat: "СберДиск (совместимый профиль)",
    filesystem: "Локальный диск / NAS",
    other: "Другое",
  },
  backupTransportType: { s3: "S3", webdav: "WebDAV", filesystem: "Файловая система", other: "Другое" },
} as const;

export type CodebookName = keyof typeof CODEBOOK;
export type Code<N extends CodebookName> = keyof (typeof CODEBOOK)[N] & string;


export function codesOf<N extends CodebookName>(name: N): [Code<N>, ...Code<N>[]] {
  return Object.keys(CODEBOOK[name]) as [Code<N>, ...Code<N>[]];
}


export function labelOf<N extends CodebookName>(name: N, code: string | null | undefined): string {
  if (!code) return "—";
  const book = CODEBOOK[name] as Record<string, string>;
  return book[code] ?? code;
}


export function optionsOf<N extends CodebookName>(name: N): { value: Code<N>; label: string }[] {
  return codesOf(name).map((value) => ({ value, label: labelOf(name, value) }));
}

export function isCode<N extends CodebookName>(name: N, value: unknown): value is Code<N> {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CODEBOOK[name], value);
}


export const CODEBOOK_COLUMNS: ReadonlyArray<{ table: string; column: string; book: CodebookName; nullable?: boolean }> = [
  {"table":"external_listings","column":"date_source","book":"listingDateSource"},
  {"table":"external_listings","column":"date_precision","book":"listingDatePrecision"},
  {"table":"external_listings","column":"price_per_m2_unit","book":"pricePerM2Unit","nullable":true},
  {"table":"external_listing_snapshots","column":"date_source","book":"listingDateSource"},
  {"table":"external_listing_snapshots","column":"date_precision","book":"listingDatePrecision"},
  {"table":"external_listing_snapshots","column":"price_per_m2_unit","book":"pricePerM2Unit","nullable":true},
  {"table":"interactive_browser_sessions","column":"source","book":"externalSource"},
  {"table":"interactive_browser_sessions","column":"status","book":"browserSessionStatus"},
  {"table":"listing_duplicate_groups","column":"status","book":"duplicateGroupStatus"},
  {"table":"listing_duplicate_decisions","column":"decision","book":"duplicateDecision"},
  {"table":"task_checklist_items","column":"status","book":"taskChecklistStatus"},
  {"table":"lead_requests","column":"outcome_code","book":"callOutcome","nullable":true},
  {"table":"property_collections","column":"visibility","book":"collectionVisibility"},
  {"table":"property_collection_items","column":"status","book":"collectionItemStatus"},
  {"table":"document_templates","column":"format","book":"templateFormat"},
  {"table":"document_templates","column":"status","book":"templateStatus"},
  {"table":"ai_chat_sessions","column":"context_type","book":"aiChatContextType"},
  {"table":"ai_chat_messages","column":"role","book":"aiChatRole"},
  {"table":"ai_pending_actions","column":"status","book":"aiPendingActionStatus"},
  {"table":"search_exports","column":"format","book":"searchExportFormat"},
  {"table":"search_exports","column":"scope","book":"searchExportScope"},
  { table: "external_listings", column: "source", book: "externalSource" },
  { table: "external_listings", column: "source_method", book: "externalSourceMethod" },
  { table: "external_listings", column: "operation", book: "externalOperation" },
  { table: "external_listings", column: "price_unit", book: "externalPriceUnit", nullable: true },
  { table: "external_listing_verifications", column: "availability", book: "listingAvailability" },
  { table: "search_bookmarks", column: "status", book: "searchBookmarkStatus" },
  { table: "search_selections", column: "review_status", book: "selectionReviewStatus" },
  { table: "search_runs", column: "status", book: "searchRunStatus" },
  { table: "search_run_sources", column: "source", book: "externalSource" },
  { table: "search_run_sources", column: "status", book: "searchSourceStatus" },
  { table: "search_run_results", column: "verdict", book: "searchVerdict" },
  { table: "ai_usage_logs", column: "call_type", book: "aiCallType" },
  { table: "ai_usage_logs", column: "status", book: "aiUsageStatus" },
  { table: "ai_tariffs", column: "call_type", book: "aiCallType" },
  { table: "ai_tariffs", column: "unit", book: "aiTariffUnit" },
  { table: "ai_budget_reservations", column: "status", book: "aiReservationStatus" },
  { table: "ai_settings", column: "search_context_size", book: "aiSearchContextSize" },
  { table: "calendar_events", column: "visibility", book: "calendarVisibility" },
  { table: "notifications", column: "state", book: "notificationState" },
  { table: "notifications", column: "kind", book: "notificationKind" },
  { table: "notifications", column: "source_type", book: "notificationSourceType" },
  { table: "document_properties", column: "kind", book: "propertyMediaKind" },
  { table: "deal_checklist_items", column: "status", book: "dealChecklistStatus" },

  { table: "users", column: "role_code", book: "userRole" },
  { table: "clients", column: "status", book: "clientStatus" },
  { table: "clients", column: "client_kind", book: "clientKind" },
  { table: "client_contacts", column: "contact_type", book: "contactType" },
  { table: "client_needs", column: "status", book: "needStatus" },
  { table: "client_needs", column: "stage", book: "needStage" },
  { table: "client_needs", column: "stop_reason_code", book: "stopReason", nullable: true },
  { table: "client_needs", column: "financing_type", book: "financingType", nullable: true },
  { table: "client_needs", column: "mortgage_status", book: "mortgageStatus", nullable: true },
  { table: "need_stage_history", column: "to_stage", book: "needStage" },
  { table: "need_stage_history", column: "from_stage", book: "needStage", nullable: true },
  { table: "need_stage_history", column: "to_status", book: "needStatus", nullable: true },
  { table: "need_stage_history", column: "from_status", book: "needStatus", nullable: true },
  { table: "lead_requests", column: "result_code", book: "leadResult" },
  { table: "lead_requests", column: "status_code", book: "leadStatus" },
  { table: "properties", column: "source_type", book: "propertySourceType" },
  { table: "properties", column: "status", book: "propertyStatus" },
  { table: "agreements", column: "status", book: "agreementStatus" },
  { table: "agreements", column: "agreement_type", book: "agreementType" },
  { table: "showings", column: "status", book: "showingStatus" },
  { table: "showings", column: "result_code", book: "showingResult", nullable: true },
  { table: "tasks", column: "status", book: "taskStatus" },
  { table: "tasks", column: "priority", book: "taskPriority" },
  { table: "tasks", column: "task_type", book: "taskType" },
  { table: "tasks", column: "recurrence_kind", book: "recurrenceKind" },
  { table: "deals", column: "status", book: "dealStatus" },
  { table: "deal_parties", column: "party_role", book: "dealPartyRole" },
  { table: "deal_commissions", column: "status", book: "commissionStatus" },
  { table: "advertisements", column: "status", book: "advertisementStatus" },
  { table: "commercial_offers", column: "status", book: "offerStatus" },
  { table: "commercial_offers", column: "generation_source", book: "offerGenerationSource" },
  { table: "need_property_matches", column: "status", book: "matchStatus" },
  { table: "communications", column: "communication_type", book: "communicationType" },
  { table: "communications", column: "result_code", book: "communicationResult", nullable: true },
  { table: "documents", column: "document_type_code", book: "documentType" },
  { table: "legal_entities", column: "entity_type", book: "legalEntityType" },
  { table: "import_jobs", column: "status", book: "importJobStatus" },
  { table: "import_row_results", column: "validation_status", book: "importValidationStatus" },
  { table: "import_row_results", column: "commit_result", book: "importCommitResult", nullable: true },
  { table: "backup_runs", column: "trigger_type", book: "backupTriggerType" },
  { table: "backup_runs", column: "local_status", book: "backupLocalStatus" },
  { table: "backup_target_runs", column: "upload_status", book: "backupUploadStatus" },
  { table: "backup_target_runs", column: "verify_status", book: "backupVerifyStatus" },
  { table: "backup_remotes", column: "provider_type", book: "backupProviderType" },
  { table: "backup_remotes", column: "transport_type", book: "backupTransportType" },
];

export function checkConstraintName(table: string, column: string): string {
  return `${table}_${column}_check`;
}

export function checkConstraintSql(entry: (typeof CODEBOOK_COLUMNS)[number]): string {
  const values = codesOf(entry.book)
    .map((c) => `'${c}'`)
    .join(", ");
  const cond = entry.nullable
    ? `"${entry.column}" IS NULL OR "${entry.column}" IN (${values})`
    : `"${entry.column}" IN (${values})`;
  return `ALTER TABLE "${entry.table}" ADD CONSTRAINT "${checkConstraintName(entry.table, entry.column)}" CHECK (${cond});`;
}

export const DISPLAY_LABELS: Record<string, Record<string, string>> = {
  need_operation_type: { buy: "Купить", sale: "Продажа", sell: "Продать", rent: "Арендовать", lease_out: "Сдать в аренду" },
  property_operation_type: { sale: "Продажа", rent: "Аренда" },
  property_type: { retail: "Торговое помещение", commercial_premises: "Нежилое помещение", office: "Офис", warehouse: "Склад", production: "Производство", psn_universal: "ПСН / универсальное", free_purpose: "Свободное назначение", residential: "Жилая" },
  criterion_state: { matched: "Совпадает", contradicted: "Не соответствует", unknown: "Нет сведений" },
  criterion_source: { structured: "Характеристики", rule: "Проверка описания", ai: "Анализ ИИ", manual: "Ручная проверка" },
  criterion: { rooms: "Комнаты", rentalPeriod: "Период аренды", city: "Локация", propertyKind: "Тип объекта", operation: "Операция", purpose: "Назначение", priceUnit: "Единица цены", price: "Цена", area: "Площадь", floor: "Этаж", district: "Район", owner: "Собственник" },
  price_unit: { rub_total: "за объект", rub_month: "в месяц", rub_m2: "за м²", rub_m2_month: "за м² в месяц", rub_year: "в год", rub_m2_year: "за м² в год", total: "за объект", per_month: "в месяц", per_m2: "за м²", per_m2_month: "за м² в месяц", per_year: "в год", per_m2_year: "за м² в год" },
  external_source: { ...CODEBOOK.externalSource, import: "Импорт выгрузки", feed: "Импорт выгрузки", CRM: "CRM" },
  lead_source: { referral: "Рекомендация", website: "Сайт агентства" },
};
export function displayLabel(group: string, code: string | null | undefined): string {
  return code ? DISPLAY_LABELS[group]?.[code] ?? code : "—";
}

export const EVIDENCE_LABELS: Record<string, string> = {
  matched: "Совпадает", contradicted: "Противоречит", unknown: "Нет данных",
  structured: "Структурированные поля", rule: "Правило", ai: "ИИ",
  separate_entrance: "Отдельный вход", shop_window: "Витрина", showcase: "Витрина", first_line: "Первая линия",
  wet_point: "Мокрая точка", gates: "Ворота", power_kw: "Мощность, кВт", ceiling_m: "Высота потолков, м",
  owner_confirmed: "Собственник", price_unit: "Единица цены", residential: "Жилая",
};
export function evidenceLabel(group: string, code: string): string {
  const power = code.match(/^power_from_(\d+)_kW$/iu);
  return power ? `Мощность от ${power[1]} кВт` : EVIDENCE_LABELS[code] ?? displayLabel(group, code);
}
