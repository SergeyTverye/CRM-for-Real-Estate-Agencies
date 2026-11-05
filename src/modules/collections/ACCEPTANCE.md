# AT-10 — именованные подборки v3.1

Проверка 05.11.2026, feature/tz-v3.1. Только синтетические данные.

| Требование | Реализация | Автоматическая проверка |
|---|---|---|
| Подборка без клиента; название, владелец, private/team | collection-service, collections workspace | integration AT-10; browser create |
| Смешанный XOR состав без создания CRM-сущностей | addItems, POST items | integration counts; browser counts |
| Порядок, комментарии, проверка, исключение | updateCollection/updateItem; verifyListing | integration stale/reason/verification; browser arrows |
| Статус предложения только через бизнес-действие | collectionItemAction → proposeListing/proposeProperties | повторное предложение создаёт один Match |
| Несколько доступных потребностей, отвязка | linkNeed, scoped need picker | integration multiple/unlink; authorization foreign need |
| Private чужая → 404; team без клиентских утечек | collectionScope, accessibleNeed, explicit DTO selection | authorization API, DTO, CSV |
| CSV/XLSX; формульная инъекция | общий sanitizer поиска | integration CSV escape, XLSX workbook |
| КП со снимком, без неявного переноса/отправки | createOffer | integration snapshot after Property change, PROPERTY_REQUIRED, sentAt=null |
| Аудит | writeAudit | integration audit count |

Команды (тестовая БД crm_test_h):

```
npx vitest run tests/integration/collections.test.ts tests/authorization/collections.test.ts
npx tsc --noEmit
npx eslint <TS/TSX модуля, API, страниц и tests> --max-warnings=0
node tests/e2e/collections-demo.mjs
```

Результат integration/authorization: **5/5 PASS**, 2 файла. Typecheck: один полный
прогон PASS; последний прогон общей рабочей копии остановлен на новой ошибке
`src/modules/listing-duplicates/domain/matching.ts:63` (boolean в аргументе),
вне зоны подборок. В файлах подборок ошибок нет; чужие модули не правились.
ESLint изменённых файлов: **PASS**, 0 warnings.
Browser на crm_demo, порт 3408, webpack, отдельный .next-3408: **PASS**.
Проверены создание, смешанный состав, стрелки порядка, пикер потребности, XLSX,
КП и отсутствие побочных Property/Match, блок подборок на карточке потребности.
Снимки desktop 1440px и mobile 390px просмотрены. Ошибок JavaScript нет.
Сценарий создаёт свои временные подборку и draft КП, удаляет только их в finally.
Файл доказательств и снимки вне Git: `D:/crm-review/collections-v31/`.
Проверки не вызывают AI или площадки; transfer smoke использует уже связанное объявление,
а создание новой Property делегировано существующему transferToCatalog.

Схема, миграции и зависимости не менялись. Контракт для нового агента поиска — README.md рядом.
В поисковом bulk-service ещё требуется подключить addItems вместо собственного fallback;
этот файл принадлежит параллельному агенту и здесь не менялся.
