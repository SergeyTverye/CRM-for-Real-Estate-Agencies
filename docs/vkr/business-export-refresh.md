# Русские бизнес-метки экспорта v3.1

Повторный экспорт сохранённых LIVE-результатов из `crm_demo`, без новых запросов к площадкам, AI и web search. ТЗ v3.1 SR-08, AT-09/10. Схема БД, настройки AI, пользователи и сессии не менялись; штатные сервисы записали только журнал экспорта/аудит.

- Поиск: `office-repeat`, 70 строк; выбранные: те же четыре объявления, что на предыдущем кадре P0-A.
- Подборка: «LIVE v3.1 — офисы без клиента», 24 строки.
- Все шесть XLSX/CSV находятся в `docs/vkr/exports/v31`, рядом SHA256SUMS. Состав, SHA256 и ссылки на первоисточники: [машинный протокол](business-export-refresh.json).
- Общие метки берутся из codebook; словарь доказательств перенесён из UI в shared с прежним экспортом для UI. Неизвестные технические значения не выводятся как коды. Неподтверждённая единица цены остаётся «Не указано», без догадки по сумме.
- Деньги: `5 100 000,00 ₽`; площадь: `103,00`; дата: `dd.mm.yyyy hh:mm`, Asia/Novosibirsk. В XLSX сохранены числовые/дата-ячейки, безопасные HTTP(S)-гиперссылки, фильтр и закреплённая шапка. Формулы экранируются; CSV сохраняет BOM.
- Кадр `docs/screenshots/vkr/v31/search-export-xlsx.png`: штатный search-selected.xlsx → LibreOffice → PDF (8 страниц) → Poppler PNG. Все страницы просмотрены; итоговый контактный лист содержит страницы 1, 2, 4, 5, без изменения содержимого. Manifest и SHA256SUMS обновлены после просмотра.

Проверки: `npx tsc --noEmit` PASS; целевой ESLint с `--max-warnings=0` PASS; integration поиска/подборок 23/23 PASS; финальные unit/authorization 85/85 PASS. БД тестов — `crm_test_d`. Внешних вызовов: 0, новых пакетов и миграций: 0. Предупреждение pg о параллельном client.query не влияет на результат тестов.

Воспроизведение: явно задать DATABASE_URL на crm_demo; `npx tsx scripts/vkr/refresh-business-exports.ts`; `node scripts/vkr/render-business-export.mjs`; просмотреть PNG в `data/business-export-render` и итоговый кадр; `node scripts/vkr/render-business-export.mjs --reviewed`. Нужны LibreOffice и pdftoppm; `SOFFICE_PATH` позволяет выбрать исполняемый файл.
