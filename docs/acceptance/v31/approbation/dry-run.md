# AT-18 — технический пробный прогон сценариев апробации (dry run)

Дата: 2026-11-05T23:11:49.602Z. Это **технический прогон Playwright**, а не апробация людьми.

Проверяет саму программу `docs/acceptance/v31/approbation/README.md`: проходит те же шаги через
интерфейс, измеряет время действий и фиксирует ошибки, чтобы бланки заполнялись на рабочей сборке,
а не на пустом месте. Результаты ниже не заменяют AT-18.

## Условия прогона

- Адрес: http://localhost:3420, сборка `NEXT_DIST_DIR=.next-3420`, БД `crm_demo` (синтетика).
- `SCRAPER_DEMO_FIXTURES=true` — записанные ответы площадок, живые запросы не выполняются.
- `AI_ENABLED=false` — платные вызовы Yandex AI отсутствуют; проверяется ранее подготовленный черновик.
- Скрипт: `scripts/approbation/timing.ts`. Артефакты: `data/approbation-dry-run/`.
- Маркер синтетических записей прогона: `APPROB-DRY`.

## Итог по ролям

### Руководитель (manager)

| ID | Сценарий | Время (мин:сек) | Статус | Примечание |
|---|---|---|---|---|
| S00 | Вход в систему | 0:06 | OK |  |
| S03 | Поиск с фильтрами и свежестью | 0:57 | FAIL | locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\manager-S03-fail.png) |
| S05 | Подборка без клиента → привязка → КП | 0:10 | PARTIAL | демонстрационная подборка не найдена в списке |
| S07 | Планер: неделя и три месяца | 0:59 | FAIL | locator.selectOption: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\manager-S07-fail.png) |
| S10 | Таймлайн клиента | 0:37 | OK | лента клиента и фильтр по виду события работают |
| S11 | Шаблон документа | 1:19 | OK | предпросмотр preview.docx получен без сохранения документа |
| S14 | Контроль руководителя | 0:42 | OK | показатели и drill-down до первичных записей доступны |


### Риелтор 1 (realtor1)

| ID | Сценарий | Время (мин:сек) | Статус | Примечание |
|---|---|---|---|---|
| S00 | Вход в систему | 0:23 | OK |  |
| S01 | Звонок: спам без клиента | 0:31 | OK | спам-звонок виден в отчёте источников |
| S02 | Звонок перспективный: потребность и задача | 0:36 | FAIL | locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S02-fail.png) |
| S03 | Поиск с фильтрами и свежестью | 0:43 | FAIL | locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S03-fail.png) |
| S04 | Группа дублей: решение сотрудника | 0:13 | PARTIAL | группа вероятных дублей не появилась на записанных ответах |
| S05 | Подборка без клиента → привязка → КП | 0:47 | PARTIAL | демонстрационная подборка не найдена в списке |
| S06 | Экспорт XLSX | 0:32 | OK | скачан property-search.xlsx (весь отфильтрованный набор) |
| S10 | Таймлайн клиента | 0:46 | FAIL | locator.waitFor: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S10-fail.png) |
| S12 | AI-чат с подтверждением черновика | 0:35 | FAIL | locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S12-fail.png) |


### Риелтор 2 (realtor2)

| ID | Сценарий | Время (мин:сек) | Статус | Примечание |
|---|---|---|---|---|
| S00 | Вход в систему | 0:21 | OK |  |
| S01 | Звонок: спам без клиента | 0:38 | OK | спам-звонок виден в отчёте источников |
| S06 | Экспорт XLSX | 0:60 | OK | скачан property-search.xlsx (весь отфильтрованный набор) |
| S07 | Планер: неделя и три месяца | 0:55 | FAIL | locator.selectOption: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S07-fail.png) |
| S08 | Чек-лист задачи | 0:47 | FAIL | locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S08-fail.png) |
| S09 | Массовые напоминания | 1:06 | FAIL | locator.fill: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S09-fail.png) |
| S13 | Проверка площадки (CAPTCHA) и запасной путь | 1:15 | FAIL | locator.waitFor: Timeout 60000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S13-fail.png) |


## Сводка

| Показатель | Значение |
|---|---|
| Шагов пройдено | 23 |
| OK | 10 |
| PARTIAL | 3 |
| FAIL | 10 |
| Ошибки JS в браузере | 0 |

## Найденные дефекты и ограничения

- **FAIL** `S03` (manager): locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\manager-S03-fail.png)
- **PARTIAL** `S05` (manager): демонстрационная подборка не найдена в списке
- **FAIL** `S07` (manager): locator.selectOption: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\manager-S07-fail.png)
- **FAIL** `S02` (realtor1): locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S02-fail.png)
- **FAIL** `S03` (realtor1): locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S03-fail.png)
- **PARTIAL** `S04` (realtor1): группа вероятных дублей не появилась на записанных ответах
- **PARTIAL** `S05` (realtor1): демонстрационная подборка не найдена в списке
- **FAIL** `S10` (realtor1): locator.waitFor: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S10-fail.png)
- **FAIL** `S12` (realtor1): locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor1-S12-fail.png)
- **FAIL** `S07` (realtor2): locator.selectOption: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S07-fail.png)
- **FAIL** `S08` (realtor2): locator.click: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S08-fail.png)
- **FAIL** `S09` (realtor2): locator.fill: Timeout 30000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S09-fail.png)
- **FAIL** `S13` (realtor2): locator.waitFor: Timeout 60000ms exceeded. (скриншот: data\approbation-dry-run\realtor2-S13-fail.png)

### Ошибки JavaScript на страницах

Не зафиксировано.

## Созданные синтетические записи (маркер прогона)

- lead_requests (спам-звонок), маркер в summary
- property_collections (без клиента)

Скрипт по завершении удаляет строки с маркером прогона и возвращает демонстрационный черновик
AI-помощника в состояние «предложено».



## Что осталось за пределами прогона

- Живая площадка и CAPTCHA: детект `needs_user_action` на записанных ответах не воспроизводится —
  проверяется только запасной путь (импорт выгрузки, добавление по ссылке) и ручной проход сотрудником.
- Платные вызовы Yandex AI, реальный Excel предприятия, фирменные договоры.
- Субъективные оценки удобства 1–5 и замечания процесса: заполняются людьми в бланках.
