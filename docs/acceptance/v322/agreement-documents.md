# P1-A — документы договора, v3.2.2

## Обоснование миграции

Задание требует различать договор, дополнительное соглашение и приложение по типу
документа. Старый CHECK `documents_document_type_code_check` разрешает только
`agreement`, `title_document`, `commercial_offer`, `act`, `invoice`, `photo`, `other`.
Попытка загрузки нового типа воспроизвела отказ CHECK в PostgreSQL и SQLite.
Миграция `20261108190000_agreement_document_types` расширяет только этот codebook.
PostgreSQL заменяет CHECK; SQLite пересоздаёт таблицу в транзакции с сохранением
всех колонок, ссылок, индексов и триггера архивирования обложки. Исторические
миграции не меняются. Проверка обновления с существующим документом и ссылкой:
`tests/unit/agreement-document-migration.test.ts`.

## Протокол

Дата: 08.11.2026. Ветка: `feature/ux-search-v3.2.2-docs`.
Данные исключительно синтетические: руководитель, два риелтора, тестовый клиент,
черновой договор, небольшой PDF и DOCX, сформированный библиотекой `docx`.
Предусловия: сгенерированы оба Prisma-клиента; PostgreSQL доступна на
127.0.0.1:55432; интеграционные проверки используют только `crm_test`.
SQLite создаётся из миграций в отдельном временном файле для каждого набора.

| Проверка / действия | Ожидаемый результат | Фактический результат / evidence | Статус |
| --- | --- | --- | --- |
| Загрузить PDF договора, DOCX допсоглашения и PDF приложения | Три DocumentAgreement; тип, имя, дата, автор, юрлицо; исходное содержимое при скачивании | `tests/integration/agreement-documents.test.ts`, PostgreSQL и SQLite | PASS |
| Скачать документ прямым URL | Attachment, безопасное имя, private/no-store; storage key отсутствует в DTO | Тот же integration-тест и существующий `deals-offers-documents.test.ts` | PASS |
| Архивировать документ | Из обычного списка исчезает; metadata и файл остаются; руководитель сохраняет доступ | Тот же integration-тест, обе СУБД | PASS |
| Архивировать договор и запросить загрузку напрямую | Сервер отклоняет загрузку, новые файлы не создаются | Тот же integration-тест, обе СУБД | PASS |
| Чужой договор/документ: открыть, скачать, загрузить, архивировать, запросить список | 404, пустой список без имени/пути; файлы не создаются | `tests/authorization/agreement-documents.test.ts`, обе СУБД | PASS |
| Договор виден через своего клиента, но ответственный другой | Чтение не даёт права загрузки; автор чужого файла не может архивировать его | Authorization-тест: 403 для mutation, руководителю разрешено | PASS |
| Отправить EXE, поддельный PDF, файл сверх лимита | Сервер отклоняет; исходная политика сохранена | `deals-offers-documents.test.ts`, `tests/unit/file-policy.test.ts` | PASS |
| Загрузить очередь с ошибкой одного файла, затем повторить | Остальные файлы продолжают загружаться; повтор содержит только неудачные File и тот же agreement ID | `tests/unit/agreement-document-uploads.test.ts`, включая сетевой сбой | PASS |
| Обновить SQLite с существующим документом и ссылкой | Данные, FK, индекс и триггер сохраняются; неизвестный тип запрещён | `tests/unit/agreement-document-migration.test.ts` | PASS |

Изменения интерфейса: в новой форме можно выбрать несколько файлов и тип каждого,
убрать файл, увидеть ошибку формата/размера. POST документов выполняется только
после успешного POST договора. Ошибка сохранения не сбрасывает File; ошибка
загрузки оставляет ID договора и очередь неудачных файлов. Форма блокируется
во время сохранения/загрузки, предупреждает при закрытии с несохранёнными файлами.
После успеха — переход `/agreements/:id#documents`. Повтор не создаёт договор.
Кнопка загрузки карточки использует прежние StorageAdapter и защищённый API.

## Команды и доказательства

```powershell
npx tsc --noEmit
npx vitest run --project unit tests/unit/agreement-document-uploads.test.ts tests/unit/agreement-document-migration.test.ts tests/unit/file-policy.test.ts
npx vitest run --project integration --project authorization tests/integration/agreement-documents.test.ts tests/authorization/agreement-documents.test.ts tests/integration/deals-offers-documents.test.ts
npx vitest run --project integration-sqlite tests/integration/agreement-documents.test.ts tests/authorization/agreement-documents.test.ts tests/integration/deals-offers-documents.test.ts
$env:E2E_DEV='true'
npx playwright test --config tests/e2e/agreement-documents.config.ts
```

ESLint запускается для всех изменённых TS/TSX с `--max-warnings=0`.
Unit: 9/9; PostgreSQL integration/authorization: 10/10; SQLite: 10/10.
Локальные подробные логи: `data-docs-unit.log`, `data-docs-pg.log`,
`data-docs-sqlite.log`, `data-docs-typecheck-final.log`, `data-docs-lint*.log`,
`data-docs-e2e.log` (игнорируются Git).

## Браузерная проверка

`tests/e2e/agreement-documents.spec.ts` содержит основной цикл (создание с PDF,
догрузка допсоглашения, скачивание, архив) и сценарий ошибок (400 при сохранении,
503 при загрузке, повтор только неудачного файла без дубликата договора).
Отдельный config/setup сохраняет общий Playwright-контракт, но обновляет CHECK
в одноразовой `crm_e2e`: общий setup копирует схему `crm_demo`, которая может
отставать от этой ветки. Другие БД этим setup не обновляются.
Для запуска нужны Docker с тестовым контейнером из общего e2e setup, синтетическая
`crm_demo` и установленный Chromium Playwright. Production build не требуется
при `E2E_DEV=true`.

Браузерный результат: PASS, 2/2 Chromium, 3.0 минуты. Проверены в настоящем
браузере основной цикл и восстановление после ошибок без повторного договора.
Прогон выполнен с локальной обёрткой `data/docs-checks/playwright.config.ts`,
эквивалентной опубликованным config/setup (добавляла CHECK в crm_e2e).
В логе dev-сервера при переходе встретилось `The destination stream errored
while writing data`; оба сценария завершились успешно. Production build и
полный регрессионный набор проекта в рамках этой задачи не запускались.
Typecheck: PASS. ESLint изменённых файлов: PASS, `--max-warnings=0`.

## Ограничения

Очередь File живёт в памяти открытой формы. Перезагрузка/закрытие страницы после
предупреждения сбрасывает незагруженные файлы; сохранённый договор остаётся,
их можно выбрать заново в карточке. Расширения и размеры ограничиваются текущей
конфигурацией; сервер дополнительно проверяет сигнатуру содержимого.
Архивирование сохраняет файл и авторизованное скачивание — это существующая
политика, а не физическое удаление. Новые зависимости не добавлены.
