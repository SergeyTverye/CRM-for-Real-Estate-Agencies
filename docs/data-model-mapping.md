# Соответствие модели данных: ТЗ → Prisma → PostgreSQL

Нормативный источник — раздел 29 ТЗ v1.6.1. Исполняемая реализация — [`prisma/schema.prisma`](../prisma/schema.prisma)
и миграция [`prisma/migrations/*_baseline_schema`](../prisma/migrations), которая создаёт всю baseline-схему с нуля (ТЗ 29.13).

## Общие правила реализации

| Правило ТЗ | Реализация |
|---|---|
| PK — UUID | `uuid` с `DEFAULT gen_random_uuid()` для всех основных сущностей; join-таблицы — составной PK из двух FK |
| Имена snake_case | `@map`/`@@map` во всех моделях |
| Моменты времени — timestamptz | `timestamptz(3)`: миллисекундная точность совпадает с JS `Date`, что нужно для optimistic concurrency по `updated_at` (ТЗ 40.10) |
| Календарные даты — date | `valid_until`, `expires_at` (реклама, КП), `due_at` комиссии, `recurrence_until`, `deal_date` архива |
| Деньги — numeric(16,2) | цены, бюджеты, комиссии, `deal_price`; float запрещён (проверяется тестом) |
| Нет ON DELETE CASCADE | все FK — `ON DELETE RESTRICT`; бизнес-сущности архивируются (`archived_at`/`status`/`is_active`) |
| Системный codebook | `text` + CHECK, значения из [`src/shared/codebook.ts`](../src/shared/codebook.ts); тест `tests/unit/codebook-migration.test.ts` сверяет код и миграцию |
| Бизнес-справочники | таблица `dictionary_items` (category, code, display_name, is_active) — каналы, источники, площадки, типы объектов/операций |
| JSONB | только `properties.attributes_jsonb` (редкие характеристики), `audit_log.before/after`, `import_jobs.summary_jsonb` (технический отчёт) |
| Generic entity_type/entity_id | только `audit_log` и `ai_runs` (разрешённое ТЗ исключение); связи Task/Document — нормализованные join-таблицы |

## Сущности ТЗ → модели → таблицы

| Сущность ТЗ | Prisma model | Таблица | Примечание |
|---|---|---|---|
| User | User | users | login хранится в lowercase, CHECK + UNIQUE |
| UserSession | UserSession | user_sessions | только SHA-256 токена (`token_hash` UNIQUE) |
| PropertyContactGrant | PropertyContactGrant | property_contact_grants | partial UNIQUE(property_id, user_id) WHERE revoked_at IS NULL |
| Client | Client | clients | статус active/inactive/archived |
| ClientContactPerson | ClientContactPerson | client_contact_persons | для организаций |
| ClientContact | ClientContact | client_contacts | partial UNIQUE(client_id, contact_type, normalized_value); индекс normalized_value для дублей |
| LeadRequest | LeadRequest | lead_requests | факт обращения сохраняется без потребности |
| ClientNeed | ClientNeed | client_needs | CHECK closed ⇒ stop_reason_code + closed_at; other ⇒ комментарий |
| NeedStageHistory | NeedStageHistory | need_stage_history | append-only; доп. колонки from_status/to_status (ADR-0005) |
| Property | Property | properties | source_type agency_listing/external_market |
| PropertyOwner | PropertyOwner | property_owners | UNIQUE(property_id, client_id); контакты берутся из client_contacts после проверки права |
| NeedPropertyMatch | NeedPropertyMatch | need_property_matches | история повторных предложений сохраняется (без UNIQUE) |
| Communication | Communication | communications | append-oriented |
| Showing | Showing | showings | доп. `participants_text` для участников показа (ТЗ 6.3) |
| Task (+ Reminder) | Task | tasks | повторяемость: recurrence_*, parent_task_id; CHECK postdeal ⇒ подвид |
| task_* links | TaskClient … TaskCommercialOffer | task_clients, task_needs, task_properties, task_showings, task_deals, task_advertisements, task_agreements, task_commercial_offers | составной PK |
| Advertisement | Advertisement | advertisements | ad_text, сроки, last_checked_at |
| Agreement | Agreement | agreements | CHECK хотя бы одна связь; signed ⇒ signed_at |
| LegalEntity | LegalEntity | legal_entities | entity_type IP/LLC |
| Deal | Deal | deals | комиссии НЕ хранятся в deals |
| DealParty | DealParty | deal_parties | CHECK client_id или external_party_name |
| DealCommission | DealCommission | deal_commissions | amount numeric(16,2) NOT NULL, несколько на сделку |
| CommercialOffer | CommercialOffer | commercial_offers | legal_entity_id для prepared/sent от имени предприятия |
| CommercialOfferItem | CommercialOfferItem | commercial_offer_items | snapshot цены/адреса/площади/условий; UNIQUE(offer, property) |
| Document | Document | documents | storage_key UNIQUE, бинарные данные вне БД |
| document_* links | DocumentClient … DocumentCommercialOffer | document_clients, document_needs, document_properties, document_showings, document_deals, document_advertisements, document_agreements, document_commercial_offers | составной PK |
| AuditLog | AuditLog | audit_log | before/after без секретов |
| HistoricalDealArchive | HistoricalDealArchive | historical_deal_archive | нет паспорта/регистрации/даты рождения; source_row_key UNIQUE для идемпотентного импорта |
| ImportJob / ImportRowResult | ImportJob / ImportRowResult | import_jobs / import_row_results | validation_status и commit_result раздельно |
| BackupRun / BackupRemote / BackupTargetRun | BackupRun / BackupRemote / BackupTargetRun | backup_runs / backup_remotes / backup_target_runs | секреты не хранятся |
| AiRun | AiRun | ai_runs | без полного prompt/response |
| (бизнес-справочники, ТЗ 40.9) | DictionaryItem | dictionary_items | UNIQUE(category, code) |

## Служебные поля сверх раздела 29 (аддитивные, ADR-0005)

- `created_by` в lead_requests, client_needs, properties, showings, deals — ТЗ 19.1 требует фиксировать автора критичных сущностей.
- `updated_at` в lead_requests — optimistic concurrency и смена статуса обращения.
- `client_needs.notes`, `tasks.result_comment` — свободный комментарий (FR-15) и итог выполнения задачи (ТЗ 37.9).
- `need_stage_history.from_status/to_status` — переходы статуса потребности для событийной аналитики (FR-24).
- `historical_deal_archive.deal_date_text`, `additional_info`, `import_job_id` — исходное представление даты и доп. сведения реестра, связь с запуском импорта.
- `import_jobs.source_storage_key`, `summary_jsonb`, `updated_at` — временное хранение исходного файла до завершения задания и сводка секций.

## Ключевые кардинальности (ТЗ 29.11)

- User 1:N Client / ClientNeed / Task / Property / Showing / Deal (по ответственному).
- Client 1:N ClientContactPerson, ClientContact, ClientNeed, Communication; ClientContactPerson 1:N ClientContact.
- Client M:N Property через PropertyOwner; Client M:N Deal через DealParty.
- ClientNeed M:N Property через NeedPropertyMatch; ClientNeed 1:N Showing, NeedStageHistory, CommercialOffer.
- Property 1:N Advertisement; Deal 1:N DealParty, DealCommission; CommercialOffer 1:N CommercialOfferItem.
- LegalEntity 1:N Deal; nullable FK в Agreement, CommercialOffer, Document.
- BackupRun M:N BackupRemote через BackupTargetRun; User 1:N AiRun.

## Полный список моделей и внешних ключей (сгенерировано из schema.prisma)

| Prisma model | Таблица PostgreSQL | Внешние ключи |
|---|---|---|
| `User` | `users` | — |
| `UserSession` | `user_sessions` | user_id |
| `PropertyContactGrant` | `property_contact_grants` | property_id, user_id, granted_by |
| `Client` | `clients` | responsible_user_id, created_by |
| `ClientContactPerson` | `client_contact_persons` | client_id |
| `ClientContact` | `client_contacts` | client_id, contact_person_id |
| `LeadRequest` | `lead_requests` | client_id, client_need_id, property_id, advertisement_id, responsible_user_id, created_by |
| `ClientNeed` | `client_needs` | client_id, responsible_user_id, created_by |
| `NeedStageHistory` | `need_stage_history` | client_need_id, changed_by |
| `Communication` | `communications` | client_id, client_need_id, lead_request_id, author_user_id |
| `Property` | `properties` | responsible_user_id, created_by |
| `PropertyOwner` | `property_owners` | property_id, client_id |
| `NeedPropertyMatch` | `need_property_matches` | client_need_id, property_id, created_by |
| `Showing` | `showings` | client_need_id, property_id, responsible_user_id, created_by |
| `Advertisement` | `advertisements` | property_id, responsible_user_id |
| `Agreement` | `agreements` | client_id, property_id, deal_id, responsible_user_id, legal_entity_id |
| `Task` | `tasks` | responsible_user_id, created_by, parent_task_id |
| `TaskClient` | `task_clients` | task_id, client_id |
| `TaskNeed` | `task_needs` | task_id, client_need_id |
| `TaskProperty` | `task_properties` | task_id, property_id |
| `TaskShowing` | `task_showings` | task_id, showing_id |
| `TaskDeal` | `task_deals` | task_id, deal_id |
| `TaskAdvertisement` | `task_advertisements` | task_id, advertisement_id |
| `TaskAgreement` | `task_agreements` | task_id, agreement_id |
| `TaskCommercialOffer` | `task_commercial_offers` | task_id, commercial_offer_id |
| `LegalEntity` | `legal_entities` | — |
| `Deal` | `deals` | property_id, responsible_user_id, created_by, legal_entity_id |
| `DealParty` | `deal_parties` | deal_id, client_id |
| `DealCommission` | `deal_commissions` | deal_id, payer_party_id |
| `CommercialOffer` | `commercial_offers` | client_need_id, responsible_user_id, created_by, legal_entity_id |
| `CommercialOfferItem` | `commercial_offer_items` | commercial_offer_id, property_id |
| `Document` | `documents` | uploaded_by, legal_entity_id |
| `DocumentClient` | `document_clients` | document_id, client_id |
| `DocumentNeed` | `document_needs` | document_id, client_need_id |
| `DocumentProperty` | `document_properties` | document_id, property_id |
| `DocumentShowing` | `document_showings` | document_id, showing_id |
| `DocumentDeal` | `document_deals` | document_id, deal_id |
| `DocumentAdvertisement` | `document_advertisements` | document_id, advertisement_id |
| `DocumentAgreement` | `document_agreements` | document_id, agreement_id |
| `DocumentCommercialOffer` | `document_commercial_offers` | document_id, commercial_offer_id |
| `HistoricalDealArchive` | `historical_deal_archive` | client_id, import_job_id |
| `ImportJob` | `import_jobs` | started_by |
| `ImportRowResult` | `import_row_results` | import_job_id |
| `BackupRun` | `backup_runs` | initiated_by_user_id |
| `BackupRemote` | `backup_remotes` | — |
| `BackupTargetRun` | `backup_target_runs` | backup_run_id, backup_remote_id |
| `AuditLog` | `audit_log` | actor_user_id |
| `AiRun` | `ai_runs` | requested_by_user_id, output_document_id |
| `DictionaryItem` | `dictionary_items` | — |

Все внешние ключи проиндексированы (`@@index`), дополнительно — индексы из ТЗ 29.12 и функциональные индексы `lower()` для поиска.
