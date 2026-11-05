# Шаблоны документов v3.1

Руководитель открывает «Шаблоны документов» (`/templates`), задаёт код, название, формат, YAML-манифест и Markdown либо файл. Сохранение проверяет шаблон на синтетических данных; предпросмотр скачивается в DOCX/XLSX для проверки в офисном приложении. История показывает манифест, описание совместимости и предпросмотр каждой неизменяемой версии. Новый шаблон и новая версия доступны немедленно, без сборки и перезапуска.

Состояния: действует, отключён, архив. Отключение/архив запрещают новые формирования; исторические версии, документы и снимки остаются. Изменения защищены `expectedUpdatedAt`, аудитом и транзакцией. Код и формат версии неизменяемы; новый формат требует отдельного шаблона.

В карточках клиента, сделки, КП и подборки доступна кнопка «Сформировать по шаблону». Выберите шаблон, скачайте предпросмотр, затем явно подтвердите сохранение. Версия фиксируется при выборе; значения CRM повторно читаются при сохранении. Результат и ранее сформированные файлы доступны в этом диалоге. Для клиентов/потребностей/сделок/КП/объектов дополнительно создаются существующие нормализованные Document links. Файлы физически хранятся через StorageAdapter, не в PostgreSQL. Снимок содержит только объявленные разрешённые значения, роли доступа и ссылки на источники.

## Манифест

Полные примеры: `templates/examples/client.yaml`, `collection.yaml`, `registry.yaml`, `client.md`, `collection.docx`, `collection.xlsx`. Генератор примеров: `node node_modules/tsx/dist/cli.mjs templates/examples/create-examples.ts`.

```yaml
schemaVersion: 1
entityKind: client
sources: [client, user]
fields:
  - path: client.displayName
    label: Клиент
    type: text
    required: true
    roles: [manager, realtor]
columns: # только для xlsx_registry
  - path: client.displayName
    title: Клиент
    width: 45
```

`entityKind`: client, need, deal, offer, collection, property. Источники ограничены типом: client → client/user; need → client/need/user; deal → deal/property/legalEntity/user; offer → client/need/offer/properties/legalEntity/user; collection → collection/properties/user; property → property/user. Список `sources` не расширяет серверные права.

Белый список полей находится в `domain/manifest.ts` и выводится в разделе. Типы: text, date, money, area. Реквизиты legalEntity доступны только руководителю. Контакты собственника, паспорт, регистрация, пароли, токены и произвольные заметки в каталог не включены. Имена/типы полей и источники проверяются сервером; произвольные SQL/JS/пути и вычисления запрещены. YAML anchors/aliases, пользовательские теги, повторяющиеся ключи не поддерживаются.

## Синтаксис и совместимость

- `{{client.displayName}}`, `{{deal.date}}`: скалярное поле, объявленное в манифесте. Обязательные поля проверяются даже без ссылки в тексте.
- `{{#if offer.introText}}…{{offer.introText}}…{{/if}}`: проверка наличия/истинности значения; выражения и вызовы функций запрещены.
- `{{#each properties}}{{this.address}} / {{this.area}}{{/each}}`: только массив разрешённых публичных свойств. Вложенность ограничена; нет произвольного доступа к объектам.
- Даты — `Asia/Novosibirsk`; текстовые деньги — рубли с двумя знаками, площади — м². В XLSX точный плейсхолдер money/area создаёт числовую ячейку с форматом; date — числовую дату. Значения свыше 15 цифр сохраняются текстом, чтобы Excel не терял точность.

**Markdown → DOCX:** заголовки уровней 1–3, абзацы, маркированные/нумерованные списки, pipe-таблицы. HTML, изображения, произвольный Markdown/встроенные инструкции не интерпретируются.

**DOCX → DOCX:** заменяется текст `word/document.xml`, headers/footers. Плейсхолдер может пересекать несколько `w:r`; окружающие форматирование, таблицы, разрывы страниц сохраняются. Формат подставленного значения берётся из первого run плейсхолдера. Цикл строки таблицы начинается `{{#each properties}}` в первой ячейке и завершается `{{/each}}` в последней. Для блоков абзацев/строк таблицы открывающий и закрывающий маркеры размещаются отдельно в sibling-абзацах/строках; условный блок внутри одного абзаца сохраняет стиль первого run. Content controls, текстовые поля фигур, произвольные OOXML-расширения не являются контрактом поддержки.

**XLSX → XLSX:** текстовые плейсхолдеры в ячейках; именованная ячейка использует путь с `_` вместо `.`, например `collection_name`. Для повторов `{{#each properties}}` и `{{/each}}` находятся в одной строке; вся строка копируется со стилем/высотой, `this.*` заполняет её поля. Условия — внутри текстовой ячейки. Скалярный плейсхолдер сохраняет числовой тип/дату; смешанный текст — строка. Формулы внутри повторяемой строки с относительными A1-ссылками сдвигаются по строке, `$` и строковые литералы сохраняются. Формулы пересчитывает Excel/LibreOffice при открытии. Произвольные пересчёты ссылок в формулах за пределами повторяемой строки, динамические массивы, pivot, сложные таблицы и merged cells внутри циклов не обещаются. Такой шаблон нужно адаптировать и описать ограничение в compatibilityNote.

Поддерживаемые функции формул: SUM/AVERAGE/MIN/MAX/COUNT/COUNTA, ROUND/ROUNDUP/ROUNDDOWN, IF/IFERROR/AND/OR/NOT, ABS, COUNTIF/COUNTIFS/SUMIF/SUMIFS, CONCAT/CONCATENATE/TEXT/LEN/LEFT/RIGHT/MID, YEAR/MONTH/DAY/DATE/TODAY. Внешние функции и исполняемое содержимое отклоняются. Именованные диапазоны с вычислениями запрещены.

**Декларативный XLSX-реестр:** `format=xlsx_registry`, без файла, поля и `columns` задаются манифестом. API принимает `selectedIds` доступных записей одного типа (до 200); каждая проверяется отдельно. Колонки — только скалярные поля. Реестр содержит фильтр, закреплённую шапку, ширины, переносы и форматы. Карточка формирует реестр своей записи; массовый выбор доступен через API.

## API

Все маршруты используют существующие cookie-сессии, Origin/CSRF, standby guard и формат ошибок API v1.

| Метод | Путь | Доступ и ввод |
|---|---|---|
| GET | `/api/v1/templates?entityKind=client` | Действующие совместимые шаблоны для роли; `management=true` только руководителю |
| POST | `/api/v1/templates` | Руководитель; multipart code/name/format/manifestYaml/description?/markdownBody?/file?/compatibilityNote? |
| GET | `/api/v1/templates/{id}` | Руководитель, метаданные и история; storage paths не возвращаются |
| POST | `/api/v1/templates/{id}/versions` | Те же multipart поля + expectedUpdatedAt; новый файл загружается заново |
| PATCH | `/api/v1/templates/{id}` | Руководитель; status и expectedUpdatedAt |
| GET | `/api/v1/templates/{id}/preview?versionId=…` | Руководитель; скачиваемый синтетический файл, без Document |
| POST | `/api/v1/templates/{id}/generate?preview=true` | entityKind/entityId/versionId?; реальный разрешённый контекст, без сохранения |
| POST | `/api/v1/templates/{id}/generate` | Те же поля; selectedIds? для реестра; requestId? UUID для безопасного повтора; ответ `{id}` Document |
| GET | `/api/v1/templates/documents?entityKind=…&entityId=…` | До 50 доступных файлов, перепроверяются все исходные записи |
| GET | `/api/v1/templates/documents/{id}/file` | Автор/руководитель и актуальный доступ ко всем источникам/полям |

Роли доступа снимка дополнительно проверяет общий `documentScope`: запрещённый готовый файл не раскрывается через существующий download, поиск и списки документов. Старые документы без templateVersionId сохраняют прежнее поведение.

## Ограничения безопасности

Файл до 5 МБ, распакованный пакет/результат до 20 МБ, до 500 ZIP entries, 500 КБ текста, 50 КБ манифеста, 50 полей, 30 колонок, 1000 элементов цикла, вложенность до 8; лист до 5000 строк/100 колонок, до 50 000 вычислительных/XML операций. Размер multipart ограничивается и при отсутствии Content-Length. XML DTD/entities и повреждённый XML отклоняются. Запрещены docm/xlsm, VBA, ActiveX, embedded OLE, external relationships/links, DDE, filesystem paths, небезопасные формулы. Данные, начинающиеся с `= + - @` (включая пробелы/управляющие символы), экранируются перед записью строк Excel. CSV шаблонизатор не формирует; защита экспортов CSV остаётся в существующем модуле экспорта.

Установлены с `--save-exact`: `yaml@2.9.1`, `@xmldom/xmldom@0.9.12`. Используются существующие docx/exceljs/fflate; eval/new Function отсутствуют.

## Модель подборки и граница схемы

В v3.1 есть DocumentTemplate/Version и Document.templateVersionId/valuesSnapshot, но нет `DocumentCollection`. Схема и миграции не менялись. Для подборки источник хранится в снимке `{source:{kind,ids}}`; список/скачивание идут через защищённые routes шаблонизатора, повторно проверяющие owner/team visibility. Для нормализованной FK-связи требуется add-only `DocumentCollection(documentId, collectionId)` от агента модели данных и расширение общего documentScope. До этого общий список документов не показывает файлы подборок; внутри диалога подборки они доступны. Это явное ограничение реализации связи, не потеря файлов.

## Проверки AT-15

- Unit: `tests/unit/document-templates.test.ts` — движок, типы/роли, aliases/getters/prototype, инъекции, лимиты, OOXML/макросы, run split, стили/числовые форматы/формулы.
- Integration: `tests/integration/document-templates.test.ts` — все четыре режима, версия без перезапуска, снимок, нормализованные links, архив/старый файл, конкурентный повтор requestId.
- Authorization: `tests/authorization/document-templates.test.ts` — прямой API не-руководителя, чужие Client/Need/Deal/Offer/Collection, реестр с чужой записью, отзыв доступа после передачи клиента, запрет общего documentScope для ограниченных полей.
- Browser: `node tests/e2e/document-templates-demo.mjs` против demo-сервера 3410 — manager UI, предпросмотр → явное сохранение, запрет management UI/API риелтору. Только синтетика, секреты не печатаются.
- Визуально: `templates/examples/create-examples.ts --demo` сохраняет четыре результата на crm_demo; LibreOffice headless DOCX/XLSX → PDF, PyMuPDF → PNG; PNG просмотрены. Доказательства вне Git: `D:/crm-review/templates/` (evidence.json, browser-evidence.json, 4 файла/PDF/PNG и UI screenshots). Формулы C3/B3 → C4/B4 проверены программно и пересчитаны LibreOffice. Обнаруженное разделение объектов стилей ExcelJS исправлено, добавлен регрессионный тест.

Результаты 05.11.2026: unit **29/29 PASS**, integration + authorization на отдельной `crm_test_f` **8/8 PASS**, browser на `crm_demo` **3/3 PASS**. `npx eslint` изменённых файлов `--max-warnings=0` — PASS; финальный `npx tsc --noEmit --pretty false` — **PASS, exit 0**. Ранние общие typecheck выявляли незавершённые параллельные модули; финальный прогон этих ошибок уже не содержит. `git diff --check` своей зоны — PASS. Dev-сервер 3410 остановлен; добавлений `.next-3410` в tsconfig не оставлено, изменения других агентов не откатывались. Полная production-сборка в этой задаче не запускалась. AT-15 в части нормализованной связи DocumentCollection — PARTIAL до изменения схемы координатором.
