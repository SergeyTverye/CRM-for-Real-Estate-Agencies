# Протокол испытаний v2.4.1 — этап 2

## Итог v3.1 от 06.11.2026

Release QA выполнен на `32decaacd2a313dc82a7e6fadde3cfb40d387815` с точечными
незакоммиченными исправлениями. Prisma validate, TypeScript, ESLint без предупреждений,
production build — PASS; unit/browser-cycle **1331/1331**, PostgreSQL integration/authorization
**315/315**, production `next start` Playwright **24 passed / 1 opt-in REPLAY skipped**.
Поиск v3.1 и AI-чат включены; планер, звонки, подборки и шаблоны имеют production E2E.
Все `v241.spec.ts` и `qa-stage2.spec.ts` прошли, включая сквозную сделку, PDF и RBAC.

Миграции проверены на пустой БД и восстановленной копии v2.4.1: **66→84 таблицы**,
счётчики всех прежних таблиц сохранены. Docker app/worker/search-worker/db healthy,
readiness 200; финальный backup/restore — PASS (5 файлов, 3 шаблона и 3 сформированных
документа, вход, API/checksums/строки, browser profiles исключены).
Чистый `crmclean31`: смена временного пароля, страницы 200 и отключённый scraper проверены;
первый restore выявил отсутствующий скрипт в image, после COPY-правки полный T08 PASS.
Изолированные проекты остановлены `down -v`, каталоги сохранены.

**AT-17 PARTIAL:** технические проверки рабочей копии успешны, но координатор ещё должен
зафиксировать исправления и подтвердить окончательный release SHA чистым развёртыванием.
Платных AI-вызовов нет; синтетический AI UI не объявляется LIVE. AT-18 не закрыт этим QA.
Полный журнал, команды, исправления и доказательства —
[release gate](../operations/release-gate-v31.md), [AT-17](../acceptance/v31/AT-17.md).
Ниже сохранены исторические результаты v2.4.1 с собственными границами SHA.

Дата: 05.11.2026, `feature/tz-v2.4.1`. Документационный срез `29273a9..e48ea2a`. Источники испытаний имеют собственные SHA/время; их результаты не распространяются автоматически на поздние изменения. Агент документации проверил документы и контракты, не запускал платные вызовы или полный Playwright.

**Итоговая сводка координатора (финальный SHA, unit / integration+authorization / E2E и результаты release gate): код на коммите `84e88f6`: unit 1003/1003; integration+authorization 197/197 (схема пересоздаётся с нуля); E2E Playwright 16/16 на production-сборке (`next start`); tsc, ESLint (0 предупреждений), `next build` — PASS. Независимая проверка OpenCode beam-free на `29bb4d4`: Docker app/worker/db healthy, /api/health/ready 200; чистое развёртывание из свежего клона (`d69a3fb`) — PASS (docs/operations/clean-deploy-v241.md). Независимое тестирование OpenCode iceman: 5 находок исправлены, перепроверено.**

| Проверка | Подтверждённое состояние | Доказательство и граница |
|---|---|---|
| Unit, integration/authorization | PASS зафиксированного QA-прогона | [QA этапа 2](../acceptance/qa-stage2.md); отдельная PostgreSQL, миграции с нуля; числа относятся к дате протокола |
| Typecheck / ESLint | PASS зафиксированных прогонов, без ослабления правил | QA, [LIVE](live-ai-trials.md), [UX](../acceptance/P1-reports-ai-mobile.md); финальную сводку заполняет координатор |
| Playwright | PASS dev-прогона: сквозной CRM-путь, PDF, диалоги, повторение, mobile | QA этапа 2; production Playwright на окончательном HEAD не заявляется |
| Production build общей рабочей копии | BLOCKED EPERM/Deny ACL стандартной .next | QA: удаление файла отклонено автоматической политикой; чужой ACL не изменялся |
| Изолированный clean clone и Docker build | PASS на `d69a3fb` | [чистое развёртывание](../operations/clean-deploy-v241.md): новые БД/файлы/секреты, migrate/seed, readiness/login/страницы/PDF |
| Backup/restore + restart | PASS на `d69a3fb` | T08 в отдельном Compose project: БД, файлы, вход, API файла и контрольные строки; после restart совпали checksum/счётчики |
| Уборка clean clone | PARTIAL | Docker очищен; удаление каталога отклонено политикой. Не дефект запуска CRM |
| Worker после restart | PASS проверенного контура | [Docker-протокол](../operations/docker-v241-verification.md): без дублей |
| Живой AI и источники | PASS ограниченных сценариев, WEB PARTIAL, Циан/Авито/Домклик BLOCKED | [LIVE-журнал](live-ai-trials.md), [JSON](live-ai-evidence.json), [матрица этапа 2](../acceptance/stage2-live-ai-ux.md) |
| Расходы AI | По usage/тарифу CRM, без сверки Cloud billing | Основной JSON после пересъёмки 5,925000 ₽; отдельный [P2](p2-live-ai-evidence.json) 0,346900 ₽, наборы не пересекаются |
| P2 call_note / offer_text | PASS ограниченных LIVE и автоматических сценариев | [приёмка этапа 2](../acceptance/stage2-live-ai-ux.md); сохранение только по подтверждению, общий бюджет |
| КП A4/PDF/DOCX | PASS проверенных вариантов | [протокол экспорта](../../src/modules/commercial-offers/qa/results.md); поздняя обложка/сравнение и пересъёмка — `e48ea2a`, страницы зависят от редакции |
| Подлинные скриншоты | DEMO/LIVE разделены, сохранённые LIVE-данные при пересъёмке обозначены | [реестр](screenshots.md), manifest/SHA256SUMS в каталогах; количество не фиксируется здесь при параллельной съёмке |
| NFR-14 | PARTIAL, только локально | [замер](../operations/perf-v241.md): 3 пользователя / 3 минуты, p95 ≤259 мс, 0 ошибок 5xx/409; целевое оборудование не согласовано |
| Импорт | Synthetic PASS; реальный Excel PARTIAL | [IMPORT](../acceptance/v241/IMPORT.md), фактического образца предприятия нет |
| Повтор T01–T10 / UAT | Автоматические регрессии и сквозной сценарий выполнены; полный UAT отдельно | [QA](../acceptance/qa-stage2.md), [карточки](../acceptance); окончательную сверку SHA выполняет координатор |

## История и независимая проверка

Прежний протокол на `8d30d92` относится к этапу 1 и не является актуальным итогом тестов этапа 2. Независимые отчёты Iceman и Beam сохранены локально в `D:/crm-review/`; их находки и исправления `9e2b71b` / `f15adc8` описаны в [приёмке этапа 2](../acceptance/stage2-live-ai-ux.md). Поздний `e48ea2a` содержит финальную раскладку КП и новые снимки; целевой offer-export проверен, полный общий повтор после него здесь не утверждается.

PASS отдельной строки не означает общей безусловной готовности внешних интеграций или согласованной производительности. Открытые ограничения и соответствующие статусы перечислены в матрице этапа 2.
