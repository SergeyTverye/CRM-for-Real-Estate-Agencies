# ADR-0005. Аддитивные служебные поля сверх раздела 29

- **Статус:** принято
- **Контекст:** ТЗ 19.1 требует фиксировать автора критичных записей и историю переходов; раздел 29 перечисляет минимальный набор колонок.
- **Решение:** добавлены только nullable/служебные колонки, не меняющие бизнес-контракт: `created_by` (lead_requests, client_needs, properties, showings, deals), `updated_at` (lead_requests, import_jobs), `client_needs.notes`, `tasks.result_comment`, `showings.participants_text`, `need_stage_history.from_status/to_status`, архив: `deal_date_text`, `additional_info`, `import_job_id`; импорт: `source_storage_key`, `summary_jsonb`; таблица бизнес-справочников `dictionary_items`.
- **Последствия:** перечень и назначение — в docs/data-model-mapping.md.
