# Property search hotfix — desktop v32 (scoped, PARTIAL)

> Текущее: `998b59f` установлен, [CI 42440108843](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843) полностью успешен. Поиск, интерфейс, реальное сохранение объявлений и Яндекс AI проверены. Полный протокол: [installed-search-998b59f.md](./installed-search-998b59f.md).

Статус: **PARTIAL**. Не финальная приёмка.

## Причина и исправление

- Дефект существовал **до `f6`**: desktop supervisor наследовал дефолтные env kill-switches (`AI_ENABLED=false`, `SCRAPER_ENABLED=false`, `YANDEX_WEB_SEARCH_ENABLED=false`, `YANDEX_WEB_SEARCH_AUTO_FALLBACK=false`), поэтому сохранённые `true` фактически не применялись (`ENV && persistedSetting` в `src/modules/property-search/application/dependencies.ts`).
- `f6` исправил это в `scripts/desktop/runtime/supervisor.mjs::configureSearchRuntime`: незаданные флаги рабочего стола по умолчанию `true`; явный `false` сохраняется, лимиты не повышаются. Серверные kill-switch приоритетны.
- `f6`: [42432820666](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42432820666) — SUCCESS; установленное обновление завершилось с exit 0 без изменения 415 пользовательских файлов; установленный синтетический поиск UI — 13 PASS.

## Текущий код и CI

- Продуктовый код: `7168b36`; релизный коммит: `998b59fa149399506449e3165e7b1bf322a28ecc` (отличаются только тесты/прогресс).
- CI для `7168b36`: [42439047796](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42439047796) — FAILED по одному flaky privacy-тесту (SHA содержит `1980`); unit 1935 PASS + 5 skip; SQLite 418 PASS + 1 FAIL + 1 skip.
- Координатор подтвердил `sourceRecordKey` SHA; тест исправлен структурно с негативными injection-регрессиями: **11/11 PG**, **11/11 SQLite**.
- Текущий CI для `998b59f`: [42440108843](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843) — ALL SUCCESS (build/install WinServer22/install WinServer25); детали: [installed-search-998b59f.md](./installed-search-998b59f.md).

## Источники и маршруты

- Отдельная страница `/settings/sources` (только руководитель): глобальное включение скрапера/браузерного режима и площадок `cian`, `mirkvartir`, `onrealt`, `domclick`, `yandex`, `youla`, `avito`.
- `/settings/ai`: настройки и бюджет Яндекс AI, отдельное подключение ключа/каталога.
- Навигация: «Источники поиска» и «Настройки Яндекс AI».
- Источники полностью вынесены со страницы ИИ.

## Фильтры поиска

- Основные фильтры компактны и могут сворачиваться целиком; кнопка запуска находится над ними.
- Расширенные фильтры — отдельный сворачиваемый блок с сохранением выбранных значений, счётчиком активных условий и отдельным сбросом только расширенных.
- Подсказки доступны для фильтров с клавиатурного доступа.
- «Жилая» (`residential`) отображается как «Жилая» и объединяется по ИЛИ с коммерческими назначениями.
- Неизвестное условие (например, этаж) не считается подтверждением и попадает в «требуют проверки», а не отбрасывается.
- Частичный отказ источника (`blocked`/`timeout`/`error`) не снимает объект и не равен пустой выдаче; при partial успешная выдача сохраняется.
- Клиент и потребность могут быть необязательными и сворачиваемыми.

## SQLite и сохранение дробных площадей

- Дробная площадь сохраняется через `decimal(12,2)` на границе `persistListing`.
- Реальный синтетический пакет (непустой OnRealt HTML → parser/adapter → API → worker → БД): **5/5 PG**, **5/5 SQLite** (12 строк, снимки, lease fencing, RBAC, rollback, без AI-вызовов).
- `LIVE` проверяется отдельно.

## ИИ и публичный каталог тарифов

- Публичный каталог инициализируется при каждом запуске; пользовательские тарифы, история и настройки не перезаписываются, дубли моделей исключены.
- Отсутствие тарифа — `tariff_unavailable`; отсутствие ключа — `credentials_missing` («Требуется подключение Яндекс AI»).
- Готовность: `disabled_by_server`, `disabled_by_settings`, `credential_store_unavailable`, `credentials_missing`, `ready`.
- Targeted: **7/7 PG**, **7/7 SQLite** PASS, включая web guard до изменения состояния.
- Инициализатор проверен на синтетических SQLite fresh/repeated, затем в реально установленной сборке: настоящий AI-разбор прошёл один раз, расход 0,0739 ₽, резерв 0. Для рабочего профиля ранее предоставленный ключ подключён через Windows DPAPI; настройки и бюджет сохранены.

## Результаты LIVE-адаптеров (отдельные проверки, гарантий нет)

- Office LIVE: `mirkvartir` и `onrealt` — по 12 объявлений; `youla` — пустой явный ответ; `cian`, `domclick`, `avito` — доступ ограничен; `yandex` требует действия пользователя.
- Жильё LIVE: OnRealt — 12; Мир Квартир — 7 «требуют проверки», частичный результат по таймауту.
- Жилые парсеры `avito`, `youla`, `domclick` возвращают `unsupported_filter` и не подменяют результат коммерческими объявлениями.
- CAPTCHA/блокировки возможны.

## Проверки и статусы

| Проверка | Среда | Статус |
|---|---|---|
| Полный unit официальный | CI | 1935 PASS + 5 skip |
| Полный PG (замороженные источники) | PG | 400/400 PASS |
| Полный SQLite | SQLite | 423 PASS + 1 skip (2 синтетических CLI-верификатора исключены) |
| CI SQLite для `7168b36` | CI | 418 PASS + 1 FAIL (flaky privacy) + 1 skip |
| Privacy-регрессии после структурного исправления | PG/SQLite | 11/11 и 11/11 PASS |
| Typecheck / scoped lint | local | PASS |
| Real-package OnRealt HTML+adapter+queue+DB | PG/SQLite | 5/5 и 5/5 |
| AI tariff targeted | PG/SQLite | 7/7 и 7/7 |
| Производственный restore из чистого git-архива `7168` (образ `b21ed3dbc28e53c24f1a884831b46b15c548a58c9a09247b9f2579b036460406`) | PG/SQLite | 9 и 22 PASS |
| f6 installed synthetic search UI | installed | 13 PASS |
| LIVE office / жильё | live | PARTIAL (см. выше) |
| Новая сборка EXE/install, collapse/worker/AI installed-assertions | CI/install | PASS ([installed-search-998b59f](./installed-search-998b59f.md)); rollback/reupgrade 7/7 PASS |
| Окончательный Windows CI | unit / SQLite | 1935 PASS + 5 skip / 426 PASS + 1 skip |
| Чистые VM Win10/Win11 | physical | BLOCKED решением пользователя |

## Границы

- Полный сбор по всем сайтам и фильтрам не заявляется.
- LIVE AI подтверждён одним синтетическим запросом; работоспособность всех внешних площадок и полнота их выдачи не гарантируются.
- `f6` не является финальной приёмкой поиска.

## Ссылки

- CI: [42432820666](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42432820666) (f6, SUCCESS), [42439047796](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42439047796) (`7168b36`, privacy assertion), [42440108843](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843) (`998b59f`, SUCCESS).
