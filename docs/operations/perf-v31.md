# Нагрузка v3.1 — AT-03

06.11.2026. **PASS локальной production/SYNTHETIC проверки**. Не LIVE рынок, целевое оборудование отдельно.

## Стенд и повторение

Изолированная `crm_load_v31`, PostgreSQL18 в crm-test-testdb-1, миграции deploy + обычный seed. 10000 listings/snapshots/SearchRun, семь источников, пять единиц цены, продажа/аренда; повторяющиеся цены/даты/площади/score, NULL цены у каждого 11-го, площади 13-го, publication 7-го, sourceUpdated 9-го, lastChecked 17-го. 40 probable групп по два объявления разных источников. Это искусственное распределение для ties/NULL, не статистическая модель рынка; ПДн нет. 3334 confirmed, 3333 needs_review, 3333 rejected. 3000 задач на 92 дня.

Локальный ноутбук: Intel i7-8750H 2.20GHz, 12 logical CPU, 32 GiB RAM, Windows 10.0.26200, host Node22.23.4 (отличается от Docker baseline Node24). Часть series пересекалась с тестами; выделенного стенда нет. Три одновременно работающих пользователя этим последовательным прогоном не моделируются.

[Скрипт](../../scripts/perf/search-load-v31.ts), [baseline](perf-v31-baseline.json), [итоговые метрики](perf-v31-results.json). После задания DATABASE_URL изолированной БД:

```powershell
npx prisma migrate deploy
npx prisma db seed
npx tsx scripts/perf/search-load-v31.ts prepare
$env:NEXT_DIST_DIR='.next-build'
npm run build
node node_modules/next/dist/bin/next start -p 3441
# другой терминал с тем же DATABASE_URL
npx tsx scripts/perf/search-load-v31.ts measure
```

prepare требует пустой external_listings и не удаляет данные; повторять только measure. Проверка имени БД и localhost защищает demo/production. Production build ID `_vnI5__AiPr8lxvSHCv0Q`, текущая рабочая копия с изменённым экспортом; не новый Git SHA. HTTP next start, не dev. Сессии отозваны finally.

## Results API

9 сортировок × asc/desc, по 20 страниц ×50. 1000 уникальных ID для каждой комбинации сверены с независимым SQL ORDER BY всей контрольной последовательности, включая NULLS LAST, единицы, score/id; пропусков/дублей нет, повтор первой страницы стабилен, revision неизменна. Это первые 1000, не все 200 страниц каждого порядка. Global counts сверены на каждом запросе и каждой вкладке; totals 3334/3333/3333, counts не сужаются вкладкой. incomplete=true, нет обещания полноты рынка.

Мс, p50/p95 nearest-rank по 20 HTTP ответам с чтением тела; первая страница включена, прогрева нет.

| sort.direction | p50 | p95 | max |
|---|---:|---:|---:|
| publication.asc | 162.37 | 237.60 | 1313.75 |
| publication.desc | 165.39 | 181.22 | 183.03 |
| first_seen.asc | 128.83 | 153.63 | 176.91 |
| first_seen.desc | 154.77 | 167.41 | 169.39 |
| source_updated.asc | 154.49 | 165.32 | 178.65 |
| source_updated.desc | 156.91 | 172.43 | 172.73 |
| price.asc | 169.01 | 203.83 | 219.22 |
| price.desc | 169.24 | 181.73 | 195.94 |
| price_per_m2.asc | 152.21 | 161.53 | 166.38 |
| price_per_m2.desc | 151.63 | 159.46 | 164.71 |
| area.asc | 148.86 | 167.72 | 173.02 |
| area.desc | 150.60 | 164.88 | 165.98 |
| match.asc | 161.70 | 204.32 | 216.73 |
| match.desc | 160.83 | 176.87 | 201.25 |
| last_checked.asc | 122.69 | 140.95 | 147.03 |
| last_checked.desc | 163.51 | 190.03 | 214.49 |
| price_change.asc | 158.30 | 172.95 | 180.25 |
| price_change.desc | 161.64 | 180.23 | 189.33 |

Планер: 20 HTTP агрегатов / 3000 задач /92 дня. p50=13.86, p95=20.75, max=26.53 мс; total и сумма дней=3000; первичные строки задач не возвращаются.

## Экспорт и оптимизация

До исправления: CSV 9492 мс, XLSX 9510 мс — корректность PASS, ориентир 5 с FAIL. Причина: 50 запросов по 200 с повторным digest/count/UI enrichment. Теперь внутренний пакет 2000, UI enrichment не выполняется: notes/verifications/duplicate links экспорт загружает отдельно один раз. Публичный API по-прежнему max200; exportBatch не читается из HTTP/JSON, RBAC/revision/10000 limit сохранены. Индексы/schema/миграции не менялись.

После: CSV **2741 мс**, XLSX **2814 мс**, по 10000 строк /10000 уникальных URL, порядок всей выборки совпадает с SQL. CSV checksum совпал с baseline, XLSX повторно прочитан ExcelJS. Один замер каждого формата, p95 экспорта не заявлен. Четыре колонки url/price/priceUnit/address; не все22. Визуальная проверка XLSX — предыдущий AT-09.

PG регрессия: 2005 строк пересекают пакет, 10001 даёт EXPORT_LIMIT без SearchExport, чужой actor 404, public pageSize2000 отвергнут. REPLAY цены в том же файле отдельно от LIVE.

## Оценка и проверки

Локальный ориентир 2 с для операций/5 с для отчёта соблюдён. Целевое оборудование, длительная конкурентная нагрузка и максимальный набор колонок этим прогоном не сертифицированы. AT-03 PASS критерия сортировок/пагинации/неполного охвата.

Production build PASS; unit поиска **506/506** (20 файлов); PostgreSQL **23/23** (2 файла, отдельная crm_test_a): search-server-v31 и price-replay-v31. `npx tsc --noEmit` и ESLint всех изменённых TS файлов с `--max-warnings=0` PASS; git diff --check PASS. Никаких npm install или миграций.

Неудачные начальные прогоны: даты и физические price-unit фикстуры исправлены; после прерванного prepare задачи были у другого временного user, исправлена только нагрузочная БД. Первый planner total=0 не PASS; итог total=3000. Первая integration попытка не запустилась: crm_test_a отсутствовала; создана, повтор PASS. История неудач не скрывается.


Закрытие: собственные серверы 3441/3442 остановлены, временный LIVE пользователь inactive/0 sessions. Autoinclude .next-3442 и .next-build убраны; tsconfig.json без diff, .next/ACL не менялись. Синтетические load DB/файлы метрик оставлены для воспроизведения.
