# Проверка enterprise workbook v2 — 2026-11-06

Только синтетика. Реальная книга, её копии и производные не открывались. Ни credentials, ни данные рабочего Excel не печатались. PostgreSQL schema/migrations, package.json/package-lock.json и Git-ветки не изменялись; npm install/commit/checkout/stash/reset/switch не выполнялись.

| Проверка | Фактический результат |
|---|---|
| Unit + PG integration (включая старый v1 import) | PASS: 4 файла, 16/16 тестов (5 unit, 11 PostgreSQL/API), 37.83 с |
| PG: dry-run/remap/commit/checksum/repeat | PASS |
| PG: сбой пятой записи → полный rollback → retry | PASS |
| PG: отказ половины допустимых объектных строк | PASS: 12 из 24 отклонены, остальные импортированы |
| PG: повторный импорт экспортированной книги | PASS: без прироста Client/Property/HistoricalDealArchive |
| PG: конкурирующие v2 jobs | PASS: единичный набор записей, без дублей |
| PG: hidden archive + source/responsible/status mapping | PASS |
| RBAC/application + HTTP | PASS: два риелтора лишены доступа к журналу/настройке/commit/export; HTTP 401/403, Origin 403, stale mapping 409 |
| Структура XLSX | PASS: 6 листов, 4 defined names, 126 hidden rows, 15 images, 31 source hyperlinks, 2 блока листа 5, merge, фильтры/закрепления/ширины |
| Локальный build-profile CLI на синтетике | PASS: 6 классов листов, 188 строк, 4 unresolved по координатам; stdout без заголовков и содержимого строк |
| Browser, localhost:3512, synthetic PG | PASS: 1 Playwright, 1.6 мин: upload → dry-run → resolve → commit → compatibility report → XLSX download → reopen job |
| Визуальный просмотр | PASS: просмотрен test-results/enterprise-workbook-synthetic.png; мастер доступен в обычной навигации CRM |
| Targeted ESLint --max-warnings=0 | PASS |
| npx tsc --noEmit | PASS финального прогона; промежуточные ошибки параллельной desktop-зоны и свои ошибки типов API устранены к финальной проверке |
| Dev process / tsconfig | PASS: порт 3512 остановлен; git diff tsconfig.json пустой, удалены только auto-includes .next-3512 |
| SQLite | Не запускался: те же тесты доступны агенту SQLite; код использует существующий Prisma, raw SQL отсутствует |
| Реальная книга, DT-22/DT-23 | PARTIAL: нужны доверенный координатор и локальная приёмка, синтетика не закрывает real-workbook gate |

Команды и контракт — [enterprise-workbook.md](enterprise-workbook.md). Изолированная PG: crm_test_d на 55432. Браузер запускался с NEXT_DIST_DIR=.next-3512, AI/SCRAPER=false; рабочая БД не заменялась.

Browser smoke для повторения: поднять указанный dev-сервер на синтетической БД с seedBase() и выполнить `ENTERPRISE_UI_SYNTHETIC=true npx playwright test --config scripts/private-import/playwright.enterprise.config.ts` (в PowerShell переменную задавать через `$env:`). Тот же spec совместим со стандартным E2E seed manager без переменной, но полный стандартный E2E-контур этим прогоном не проверялся.

Границы: экспортируется набор записей этого задания; формулы данных очищаются с отчётом, поддержанные изображения сохраняются; ссылки сохраняются из актуального CRM sourceUrl, остальные очищаются. Нет гарантии полного roundtrip неподдержанных Excel extensions. v1/v2 одновременно не запускать. Установка ОС ACL и retention защищённого storage — ответственность эксплуатации.
