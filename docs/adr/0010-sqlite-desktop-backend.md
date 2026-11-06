# ADR 0010: альтернативный desktop backend на SQLite

Статус: принято для прототипа этапа 1; не разрешение desktop release. Дата: 2026-11-06.
Основание: ТЗ v3.2.1 §2/§4, DT-05/06/17. Tauri не развивается до доказанного ядра.

## Схема и выбор режима

Единственный редактируемый источник модели — prisma/schema.prisma PostgreSQL. Генератор scripts/desktop/gen-sqlite-schema.ts воспроизводимо строит prisma/sqlite/schema.prisma и compatibility.json с SHA-256 исходника, картой полей, колонок, связей и масштабов. Отдельный output src/generated/prisma-sqlite. Фактически 84 модели, все перенесены; исторические 87 из ТЗ не подменяют текущий исходник.

PG migration history и PG schema не изменяются. SQLite baseline создаётся prisma migrate diff --from-empty и отдельным assembly script: действующие CHECK, FK и unique сохраняются; partial/singleton/NULLS NOT DISTINCT и PL/pgSQL перенесены отдельно в constraints.sql. Для будущих версий — новая forward migration через migrate diff, без переписывания применённой baseline. Baseline assembly предназначен только для этой первой версии.

CRM_DEPLOYMENT_MODE=server|desktop, server по умолчанию; неизвестный режим отклоняет Zod. DATABASE_URL не выбирает backend автоматически. Server остаётся PrismaPg; desktop использует ленивый async import SQLite factory, общий PrismaClient/Tx тип остаётся PG. Нативный SQLite не загружается сервером при запуске. Генерация двух клиентов независима, build/typecheck подготавливают оба для проверки optional module. Полное разделение release bundles и supervisor — этап 2.

## Точность Decimal

В adapter-better-sqlite3 7.10.1 mapArg(decimal) вызывает Number.parseFloat: DECIMAL получает SQLite REAL и уже не может гарантировать numeric(16,2). Интеграционный stock-adapter probe показывает изменение 99999999999999.99.

Решение: каждый Decimal(p,s), включая площади/доли/тарифы, становится Prisma BigInt и SQLite INTEGER в единицах 10^-s; масштаб берётся из исходного @db.Decimal, а не один глобальный «копейки». Денежные поля s=2; AI-тарифы s=6; другие масштабы сохраняются. Precision ≤16 помещается в signed 64-bit. Никакого промежуточного Number/float.

Facade переводит input/filter/nested writes/прибавления в BigInt и output/include/aggregate обратно в исходный Prisma.Decimal. Задаётся CHECK typeof(integer) и abs(value)<10^p. Неверная дробная точность, диапазон и нецелый JS number отклоняются. SUM/MIN/MAX и сравнения выполняются над целыми. AVG, multiply/divide, batch-array transaction пока явно запрещены: этап 2 должен определить округление и доказать контракт. SQL-выдача с неперенесёнными денежными DTO закрыта.

## Массивы и JSON

String[] и Int[] — JSON-массивы, с default '[]', CHECK JSON array и проверкой типов в facade. CRUD/set/read работают. Native PG scalar-list filter/push не пропускается как неизвестный SQLite оператор. JSON path/array_contains для Document.valuesSnapshot.accessRoles переписывается в ID-предикат через json_each на том же соединении, сохраняя внешние AND/OR/NOT, связи и исходные RBAC scopes. Остальные PG JSON paths — этап 2, без снятия ограничения.

## Unicode

SQLite LIKE/LOWER по умолчанию недостаточны для кириллицы. На реальном better-sqlite3 соединении регистрируются deterministic lower() и Unicode LIKE с %/_/escape и NULL semantics. Prisma mode удаляется только вместе с сохранением нужной операции; insensitive equals получает точное lower(column)=lower(?) и возвращает ID-предикат. Частичное совпадение не заменяет equals. Тесты включают Ё/ё и буквальные %/_.

Адаптер 7.10.1 не принимает пользовательский Database instance. Используется узкий runtime seam: результат публичного connect() содержит client с реальным экземпляром Database. Типизированная структурная проверка, pinned version и integration contract fail closed при несовместимости. Это сознательный риск обновления адаптера, не универсальный API. Своя вторая connection для функций не создаётся.

Функциональные lower indexes PG не копируются: их ключи зависели бы от того, какой lower зарегистрирован у connection миграции/restore. Поиск прототипа выполняется без этих индексов; production workload/index strategy — этап 2.

## Транзакции, блокировки, SQL

src/shared/db/dialect.ts содержит явные grammar-specific варианты:
- lockSql: PG исходный advisory/row SQL; SQLite SELECT без row-lock либо SELECT 1 для advisory, в уже сериализованной транзакции.
- plannerSql: timezone/IANA day, JSON1 unpivot вместо lateral VALUES, SQL GROUP BY/FILTER.
- scalarSql/reactivationSql: только известные PG casts/interval.
- requirePostgresSql: явный отказ ещё не портированной property-search выдачи.

Применение преобразований к произвольному пользовательскому SQL запрещено. Bind values остаются bind values; PG ветка возвращает исходный Prisma.Sql без изменения.

Все операции соединения и callback transaction проходят общую очередь по каноническому пути БД, включая разные facade clients; AsyncLocalStorage позволяет внутренним awaited операциям продолжить ту же транзакцию. Чтение из другого callback не видит неподтверждённые записи. BEGIN IMMEDIATE получает file writer lock до чтения общего бюджета; busy_timeout=10000. ReadCommitted/RepeatableRead callers в desktop получают Serializable; PG изоляция прежняя. Сбой ожидания освобождает mutex.

Тест AI: 12 конкурентных запросов независимых repositories, бюджет 2.50 RUB, резерв 1 RUB; проходят ровно 2, остальные AI_BUDGET_EXHAUSTED. Ledger хранит точные micro-RUB в JSON, резерв в scaled integer; rollback/retry не пропускает бюджет. Это доказательство однопроцессного desktop writer, не обещание распределённого multi-writer.

## Даты, WAL и storage

DateTime — UTC epoch ms, date-only — полночь UTC; SQL default также epoch ms. APP_TIMEZONE=Asia/Novosibirsk; planner day и date-only используют существующие IANA-функции. Тестируется переход на следующий локальный день, повтор задачи и агрегат 1500 строк.

Каждая actual connection: foreign_keys=ON, busy_timeout=10000, WAL. До WAL проверяются canonical physical path, UNC, известные cloud directories и OneDrive env roots; Windows logical drive type исключает mapped network drive, Linux запрещает NFS/SMB/CIFS/FUSE. Filesystem redirects/cloud reparse points и runtime ACL требуют дополнительной проверки упаковки. Открывать рабочую БД из облачной папки нельзя.

Document metadata и нормализованные links остаются в SQLite; файлы — StorageAdapter вне БД. Тест проверяет bytes/checksum/доступ другим пользователем. Backup не может копировать открытый файл БД: для следующего этапа нужен coordinated online snapshot + storage barrier.

## Миграции и ограничения приёмки

npm run desktop:migrate создаёт только явно выбранный SQLite-файл нативным драйвером и применяет Prisma Migrate. Это обходит воспроизведённый Windows schema-engine failure создания несуществующего файла; существующая пустая БД мигрируется штатно. Отдельный smoke проверяет clean + repeat deploy и integrity_check.

DT-05 подтверждён на перечисленном core subset, весь DT-05 остаётся PARTIAL до полной regression ролей/модулей. DT-06 PG→SQLite перенос не реализован на этапе 1. DT-17 не PASS без production/offline/restore/clean-install обоих выпусков.
Полный остаток: docs/desktop/sqlite-audit.md и sqlite-core-prototype.md.

## Источники

- Prisma 7 SQLite / timestampFormat: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite
- Исходник установленного pinned adapter: node_modules/@prisma/adapter-better-sqlite3/dist/index.mjs (mapArg, connect, startTransaction).
- SQLite WAL: https://www.sqlite.org/wal.html
- SQLite isolation / BEGIN IMMEDIATE: https://www.sqlite.org/isolation.html


## Дополнение этапа 2

Выдача поиска использует отдельный SQLite dialect: indexed correlated snapshot, JSON1, deterministic ordered digest. Пагинация/ревизии/экспорт сохраняют прежний API. Decimal — scaled INTEGER, среднее/арифметические операции вычисляются точно, не через REAL. JSON/list фильтры разрешаются внутри исходного AND/OR/relation tree, внешние RBAC predicates не снимаются.

`independentCommitScope` отделяет координацию paid AI batch от транзакций изменения данных; ошибка поздней группы не удаляет уже оплаченный cache. `BEGIN IMMEDIATE` остаётся для budget и обычных изменений.

Для clean bootstrap/upgrade/transfer используется offline migration runner с Prisma-совместимой checksum history, foreign_key_check и integrity_check; обновление предваряется SQLite backup API. Подробный протокол: [этап 2](../desktop/sqlite-stage2.md).
