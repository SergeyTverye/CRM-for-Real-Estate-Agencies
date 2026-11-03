/**
 * Системный codebook (ТЗ 19.6, 40.9).
 *
 * Стабильные коды состояний и типов, от которых зависят бизнес-инварианты,
 * права, миграция и тесты. Пользователь их не редактирует: коды зафиксированы
 * здесь и продублированы CHECK-ограничениями в SQL-миграции
 * (tests/unit/codebook-migration.test.ts проверяет их совпадение).
 *
 * Русское отображаемое название отделено от кода.
 * Изменяемые бизнес-справочники (каналы, источники, площадки, типы объектов)
 * живут в таблице dictionary_items — см. src/modules/dictionaries.
 */

export const CODEBOOK = {
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
  taskPriority: { low: "Низкий", normal: "Обычный", high: "Высокий" },
  taskType: {
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

/** Список кодов справочника в порядке объявления. */
export function codesOf<N extends CodebookName>(name: N): [Code<N>, ...Code<N>[]] {
  return Object.keys(CODEBOOK[name]) as [Code<N>, ...Code<N>[]];
}

/** Русское название кода; для неизвестного кода возвращает сам код. */
export function labelOf<N extends CodebookName>(name: N, code: string | null | undefined): string {
  if (!code) return "—";
  const book = CODEBOOK[name] as Record<string, string>;
  return book[code] ?? code;
}

/** Пары {code, label} для select-ов UI. */
export function optionsOf<N extends CodebookName>(name: N): { value: Code<N>; label: string }[] {
  return codesOf(name).map((value) => ({ value, label: labelOf(name, value) }));
}

export function isCode<N extends CodebookName>(name: N, value: unknown): value is Code<N> {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CODEBOOK[name], value);
}

/**
 * Привязка codebook к колонкам БД. Используется генератором CHECK-ограничений
 * (scripts/dev/print-check-constraints.ts) и тестом их соответствия миграции.
 */
export const CODEBOOK_COLUMNS: ReadonlyArray<{ table: string; column: string; book: CodebookName; nullable?: boolean }> = [
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
