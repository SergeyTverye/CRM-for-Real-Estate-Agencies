# Неизвестный период цены внешнего объявления

Дата: 2026-11-08. Статус: принято. Основание: AI-02, docs/vkr/live-search-v322-ai.md.

`ExternalListing.priceUnit` становится nullable. `NULL` означает, что источник не указал период; `total` остаётся только явной полной ценой. Пустая строка, фиктивный период и смешение цены с периодом не применяются. Меняется только nullability существующего поля: новые сущности и технические коды не нужны.

PostgreSQL: снять NOT NULL и явно разрешить NULL в CHECK. SQLite: пересобрать одну таблицу, скопировать все поля, восстановить все 11 явных индексов (включая два partial unique). Сама SQL-миграция устанавливает defer_foreign_keys=ON и foreign_keys=OFF перед пересборкой, затем foreign_keys=ON и defer_foreign_keys=OFF. Во внешней desktop-транзакции deferred FK позволяют пересоздать родителя, а вне транзакции (Prisma deploy) FK actions отключены на время пересборки. Исполнитель проверяет все FK перед commit без специальной обработки маркера. Проверка заполненной базы сохраняет snapshots, SearchRunResult, все индексы и integrity/FK checks.

Backfill обнуляет только записи, у которых последний source snapshot явно содержит JSON null для priceUnit. При отсутствии snapshot или ключа прежнее значение сохраняется: угадывать период по операции нельзя. В анализе явный snapshot null имеет приоритет над старым ошибочным total, в том числе до backfill. Неизвестные цены не участвуют в сравнении или расчёте цены за м²; UI показывает «период не указан», AI получает предупреждение о несопоставимости.

Для тестов и генерации PG клиента используется prisma.test.config.ts: конфигурация не открывает .env и всегда выбирает отдельную TEST_DATABASE_URL. Production-конфигурация не меняется.

Регрессия: tests/unit/listing-price-period-migration.test.ts прогоняет core и все промежуточные миграции, populated upgrade обоими путями с исходным foreign_keys=ON; сравнивает индексы/триггеры и проверяет связи, ограничения и NULL. На external_listings в core нет триггеров; сохраняются 11 явных индексов и PK autoindex. PG populated upgrade: tests/integration/listing-price-period-pg-migration.test.ts.

Проверка корректировки PRAGMA (2026-11-08): unit новой миграции и agreement-образца 4/4 PASS; integration-sqlite populated upgrade/lifecycle 3/3 PASS; PostgreSQL crm_test_e populated migration + price replay 4/4 PASS. TypeScript и ESLint изменённых файлов PASS. PG-тест поднимает прежний NOT NULL на заполненных записях, повторно выполняет SQL миграции и проверяет backfill только явного snapshot null, неизменность денег/площади, индексов и дочерней истории.
