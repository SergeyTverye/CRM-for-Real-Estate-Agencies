# Подлинные экраны ВКР

## Офлайн-переоценка назначения, 05.11.2026

Пересняты и визуально просмотрены только [04-live-results.png](../screenshots/vkr/live-ai/04-live-results.png) и [05-evidence.png](../screenshots/vkr/live-ai/05-evidence.png). Кадры 14:13:49 UTC показывают сохранённый run 33f90440-7a66-4d5f-bc8a-dadb0c271906 от 11:53:10 UTC после применения нового правила назначения. Исходно жилые результаты испытания были needs_review; на 04 теперь открыты «Исключены», на 05 раскрыто противоречие назначения с исходным фрагментом про квартиру. Это офлайн-переоценка, не новый LIVE-подбор.

Параметры: crm_demo, localhost:3396, NEXT_DIST_DIR=.next-rule, AI_ENABLED=false, SCRAPER_ENABLED=false, 1440×1000, ru-RU, Asia/Novosibirsk. Скрипт: `polish-screenshots.ts purpose-rule-only`. Новых вызовов AI/web/скрапера нет. Обе версии manifest.json и SHA256SUMS обновлены; SHA коммита в записи означает базу рабочей копии, изменения правила ещё не закоммичены. Исторические ссылки/хеши в исходном live-ai-evidence.json сохранены как свидетельство прежнего испытания; актуальные PNG и их хеши находятся в manifest/SHA256SUMS. Остальные кадры и их время не обновлялись.

| Кадр | Время кадра UTC | SHA-256 |
|---|---|---|
| 04-live-results.png | 2026-11-05T14:13:49.266Z | a55574e7396e83f9f4d13291ede56a8788239b63de11748a940e362d09370f80 |
| 05-evidence.png | 2026-11-05T14:13:49.519Z | 87907271f9e019a0c4e7a7c4fb52a7840aa3e228150d6f17971667cc551dee31 |

В кадре 07 веб-резерв действительно запущен (проверено `webSearchUsed=true`). Текущая проверка первоисточников отклоняет URL синтетического ответа FakeResponsesProvider с причиной `CATALOGUE_NOT_LISTING`: пригодных карточек — 0. Это подлинное состояние интерфейса после проверки, а не доказательство успешного живого AI-подбора. Модули AI/поиска в рамках QA не изменялись.

Сняты Playwright, viewport 1440×900 (мобильный 390×844), часовой пояс Asia/Novosibirsk. Локаль ru-RU. Режим DEMO, dev-сервер webpack на порту 3370, NEXT_DIST_DIR=.next-qa; веб-резерв — отдельный fake-only сервер 3371. Рабочая копия включает незакоммиченные доработки UI v2.4.1. Production build в этом QA-прогоне заблокирован Deny ACL в стандартной .next. В crm_demo — 25 клиентов, 25 потребностей, 40 обращений, 27 задач; три новых перспективных обращения с актуальным действием, шесть завершённых контактов (три в срок и три с опозданием). Рабочие часы 09:00–19:00 Asia/Novosibirsk; фикстуры поиска — Новосибирск, вымышленные улицы. Клиенты и коммерческие данные синтетические. В общей crm_demo сохранены также ссылки и пометки LIVE от параллельных испытаний; в карточке клиента и кадре 08 они видны как существующая история и не являются доказательством живого поиска этого DEMO-прогона. Кадр 08 снимает отдельно блок кандидатов, его статусы и перенос в каталог; тосты закрыты штатными кнопками. SHA256 каждого PNG записан в manifest.json и SHA256SUMS. Статус внешних площадок и веб-резерв демонстрируются записанными ответами и не доказывают доступность живых интеграций. [Воспроизведение и исправленный дефект](../../scripts/vkr/README.md). Каждый PNG открыт и визуально проверен; длинные страницы сняты целиком.

| Файл | Сценарий | Дата UTC | HEAD | Роль | Данные | Режим |
|---|---|---|---|---|---|---|
| [01-today.png](../screenshots/vkr/01-today.png) | Ежедневные задачи, просрочки и ближайшие действия | 2026-11-05T13:01:06.077Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [02-client-card.png](../screenshots/vkr/02-client-card.png) | Карточка синтетического клиента ООО «Сибирь Коммерция 1» | 2026-11-05T13:01:12.054Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [03-need-card.png](../screenshots/vkr/03-need-card.png) | Активная потребность и обязательное следующее действие | 2026-11-05T13:01:20.871Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [04-property-search-filters.png](../screenshots/vkr/04-property-search-filters.png) | Ручные условия поиска: Новосибирск, торговля, первый этаж, 80–150 м² | 2026-11-05T13:01:28.241Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [05-property-search-ai-adjust.png](../screenshots/vkr/05-property-search-ai-adjust.png) | Ручная корректировка фильтров при выключенном ИИ; ответ ИИ не имитируется | 2026-11-05T13:01:28.550Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [06-source-failure.png](../screenshots/vkr/06-source-failure.png) | Частичный отказ HTTP 429; успешные результаты Циан сохранены; ТЕСТОВЫЙ РЕЖИМ | 2026-11-05T13:01:31.638Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [08-selection.png](../screenshots/vkr/08-selection.png) | Кандидаты подборки и отдельная связь с каталогом CRM | 2026-11-05T13:01:35.444Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [09-property-gallery.png](../screenshots/vkr/09-property-gallery.png) | Галерея синтетических фотографий и главное фото | 2026-11-05T13:01:43.995Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [09b-lightbox.png](../screenshots/vkr/09b-lightbox.png) | Увеличение подлинного файла из StorageAdapter | 2026-11-05T13:01:44.188Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [10-offer.png](../screenshots/vkr/10-offer.png) | Структурированное КП с тремя объектами и сохранёнными снимками | 2026-11-05T13:38:09.334Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [10c-offer-pdf-page1.png](../screenshots/vkr/10c-offer-pdf-page1.png) | Первая страница настоящего многостраничного A4 PDF из кнопки «Скачать PDF» | 2026-11-05T13:38:16.295Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: синтетические данные crm_demo; Poppler render |
| [10b-offer-print.png](../screenshots/vkr/10b-offer-print.png) | DEMO: предпросмотр A4 в изолированном iframe, нейтральный шаблон | 2026-11-05T13:38:19.166Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [11-calendar-week.png](../screenshots/vkr/11-calendar-week.png) | Неделя: задачи, показы, встречи в Asia/Novosibirsk | 2026-11-05T13:02:13.080Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [11b-calendar-recurrence.png](../screenshots/vkr/11b-calendar-recurrence.png) | DEMO: редактируемая серия по будням, десять встреч; форма без сохранения | 2026-11-05T13:02:13.532Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [12-notifications.png](../screenshots/vkr/12-notifications.png) | Внутренние уведомления из демонстрационной БД | 2026-11-05T13:02:18.936Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [13-deal-documents-checklist.png](../screenshots/vkr/13-deal-documents-checklist.png) | Статусы документов сделки и связи с файлами | 2026-11-05T13:02:28.110Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [16-mobile-today.png](../screenshots/vkr/16-mobile-today.png) | Сегодня на мобильном экране 390 px | 2026-11-05T13:02:36.207Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [16b-mobile-list.png](../screenshots/vkr/16b-mobile-list.png) | DEMO: карточки списка клиентов и нижняя панель на 390 px | 2026-11-05T13:02:44.836Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [14-report-kpi.png](../screenshots/vkr/14-report-kpi.png) | KPI руководителя за фиксированный период 01.09–31.12.2026 | 2026-11-05T13:03:14.117Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | manager | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [14b-report-drilldown.png](../screenshots/vkr/14b-report-drilldown.png) | Переход из KPI в первичные записи с теми же границами | 2026-11-05T13:03:22.598Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | manager | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [15-settings-ai.png](../screenshots/vkr/15-settings-ai.png) | Настройки и ограничения ИИ, доступные руководителю | 2026-11-05T13:03:34.813Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | manager | Синтетические, crm_demo | DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo |
| [07-web-fallback.png](../screenshots/vkr/07-web-fallback.png) | DEMO: полный отказ скрапера → записанный веб-резерв; результат текущих серверных проверок первоисточника | 2026-11-05T13:08:23.597Z | 8fa50b83e070e04c153a398d7a8db1a74bafe548 | realtor1 | Синтетические, crm_demo | DEMO: FixtureScraperAdapter + FakeResponsesProvider; живого AI/веб-сбора нет |

## Финальная полировка КП и пересъёмка LIVE

Порт 3390, NEXT_DIST_DIR=.next-shots, webpack dev, devIndicators=false уже установлен в общей конфигурации другим агентом. Viewport этих кадров 1440×1000, ru-RU, Asia/Novosibirsk. DEMO 10/10b/10c/10d пересняты; 10c и 10d — настоящий PDF через html-pdf, страницы 1 и 2. Все четыре страницы PDF и четыре страницы DOCX отрендерены и просмотрены. Первоначальный прогон был без реквизитов и назначения; это исправлено при пересъёмке на порту 3395, см. ниже. При заполнении LegalEntity логотип и реквизиты выводятся; это покрыто integration-тестом.

[10d-offer-pdf-page2.png](../screenshots/vkr/10d-offer-pdf-page2.png): DEMO, A4 PDF страница 2, кадр 2026-11-05T13:38:16.297Z.

### LIVE — режим и источник

Сохранённые SearchRun, закладки, подборка и КП загружены из crm_demo с AI_ENABLED=false. На каждом таком кадре стоит подпись «LIVE-данные, сохранённые при испытании <время>, кадр переснят без новых вызовов». Это сохранённые LIVE-данные, а не повторное подтверждение доступности площадок. Время источника и время кадра указаны отдельно. Нижняя подпись добавлена только harness; данные и ответы CRM не подменяются. Тосты закрываются штатно, Next N отключён конфигурацией.

Кадры 01/02, 12/13, 14/15, 16/17 — четыре новых настоящих parse-вызова 13:34 UTC, с отдельной подписью LIVE. Новых web-вызовов и запусков скрапера нет. Старые подтверждения платного запуска, бюджеты и p2-* оставлены как исторические кадры исходных испытаний; они не объявляются переснятыми.

| Кадр | Режим | Источник / время UTC | Время кадра UTC |
|---|---|---|---|
| [01-query.png](../screenshots/vkr/live-ai/01-query.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:19.781Z | 2026-11-05T13:34:19.873Z |
| [02-ai-parsed-filters.png](../screenshots/vkr/live-ai/02-ai-parsed-filters.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:26.423Z | 2026-11-05T13:34:26.570Z |
| [12-rent-query.png](../screenshots/vkr/live-ai/12-rent-query.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:26.597Z | 2026-11-05T13:34:26.681Z |
| [13-rent-parsed.png](../screenshots/vkr/live-ai/13-rent-parsed.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:31.289Z | 2026-11-05T13:34:31.438Z |
| [14-refinement-query.png](../screenshots/vkr/live-ai/14-refinement-query.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:31.463Z | 2026-11-05T13:34:31.540Z |
| [15-refinement-parsed.png](../screenshots/vkr/live-ai/15-refinement-parsed.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:38.880Z | 2026-11-05T13:34:39.020Z |
| [16-warehouse-query.png](../screenshots/vkr/live-ai/16-warehouse-query.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:39.047Z | 2026-11-05T13:34:39.123Z |
| [17-warehouse-parsed.png](../screenshots/vkr/live-ai/17-warehouse-parsed.png) | LIVE new parse; no web | parse · 2026-11-05T13:34:45.415Z | 2026-11-05T13:34:45.588Z |
| [04-live-results.png](../screenshots/vkr/live-ai/04-live-results.png) | LIVE saved replay; offline purpose reevaluation; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T14:13:49.266Z |
| [06-source-statuses.png](../screenshots/vkr/live-ai/06-source-statuses.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:36:21.085Z |
| [19-rent-results.png](../screenshots/vkr/live-ai/19-rent-results.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 7349f731-c051-4c69-a772-5a6d3936f2f8 · 2026-11-05T12:04:09.444Z | 2026-11-05T13:36:24.172Z |
| [25-repeat-results.png](../screenshots/vkr/live-ai/25-repeat-results.png) | LIVE saved replay; AI_ENABLED=false; no new calls | b2935476-406d-415c-a960-10958ae655d8 · 2026-11-05T12:08:05.251Z | 2026-11-05T13:36:26.769Z |
| [31-web-corrected.png](../screenshots/vkr/live-ai/31-web-corrected.png) | LIVE saved replay; AI_ENABLED=false; no new calls | bce2a997-e54a-4ac6-9c8b-564f5e9845ac · 2026-11-05T12:38:05.494Z | 2026-11-05T13:36:29.322Z |
| [33-timeout-recovery.png](../screenshots/vkr/live-ai/33-timeout-recovery.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 57520939-7d91-41e3-a180-19c6485071a6 · 2026-11-05T12:34:30.026Z | 2026-11-05T13:36:33.674Z |
| [34-auto-web-cards.png](../screenshots/vkr/live-ai/34-auto-web-cards.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 81a98519-3f49-4597-9828-20214c751e5b · 2026-11-05T12:40:42.003Z | 2026-11-05T13:36:35.695Z |
| [37-empty-live.png](../screenshots/vkr/live-ai/37-empty-live.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 1a231df9-3099-4a45-85f4-fbc8c37b2e30 · 2026-11-05T12:42:14.739Z | 2026-11-05T13:36:37.536Z |
| [30-empty-results.png](../screenshots/vkr/live-ai/30-empty-results.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 1c0d904b-604e-4c0d-b484-53f0ead97c7e · 2026-11-05T12:16:02.671Z | 2026-11-05T13:36:39.363Z |
| [26-comparison.png](../screenshots/vkr/live-ai/26-comparison.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:36:49.692Z |
| [09-selection.png](../screenshots/vkr/live-ai/09-selection.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:36:56.610Z |
| [10-offer.png](../screenshots/vkr/live-ai/10-offer.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:37:00.108Z |
| [11-offer-print.png](../screenshots/vkr/live-ai/11-offer-print.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:37:03.148Z |
| [05-evidence.png](../screenshots/vkr/live-ai/05-evidence.png) | LIVE saved replay; offline purpose reevaluation; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T14:13:49.519Z |
| [08-bookmarks.png](../screenshots/vkr/live-ai/08-bookmarks.png) | LIVE saved replay; AI_ENABLED=false; no new calls | 33f90440-7a66-4d5f-bc8a-dadb0c271906 · 2026-11-05T11:53:10.129Z | 2026-11-05T13:44:55.257Z |
| [36-preserved-after-restart.png](../screenshots/vkr/live-ai/36-preserved-after-restart.png) | LIVE saved replay; AI_ENABLED=false; no new calls | bce2a997-e54a-4ac6-9c8b-564f5e9845ac · 2026-11-05T12:38:05.494Z | 2026-11-05T13:44:58.032Z |

Удалены повторные кадры; ссылки-замены: `24-repeat-confirm.png` → `23-repeat-confirm.png`; `31-web-cards.png` → `31-web-corrected.png`; `32-cian-status.png` → `31-web-corrected.png`; `21-manual-web-browser.png` → `31-web-corrected.png`; `07-web-fallback-live.png` → `34-auto-web-cards.png`; `28-fallback-statuses.png` → `34-auto-web-cards.png`; `22-preserved-bookmarks.png` → `08-bookmarks.png`. В manifest и SHA256SUMS записаны только существующие PNG; дата неизвестных исходных кадров не выдумывается. Каждый переснятый кадр просмотрен.

## Финальные исправления отображения (порт 3395)

Режим: crm_demo, webpack dev, 1440×1000, ru-RU, Asia/Novosibirsk; AI_ENABLED=false,
YANDEX_WEB_SEARCH_ENABLED=false, SCRAPER_ENABLED=false. Все POST/PUT/DELETE поиска и ИИ
дополнительно заблокированы Playwright harness. Новых вызовов Yandex/ИИ/скрапера нет:
AiUsageLog до/после — 35 записей. Исторические платные испытания выше не изменены.

Выполнено `npx tsx scripts/vkr/polish-screenshots.ts final-only`.
DEMO 10/10b/10c/10d и пять LIVE-кадров ниже пересняты и просмотрены.
10c/10d — страницы 1/2 настоящего PDF; PDF и DOCX содержат по четыре страницы A4.
DOCX проверен через LibreOffice → PDF → Poppler, просмотрены все страницы.
Полная шапка: синтетические ИНН/ОГРН-образцы с пометкой ДЕМО, адрес,
телефон +7 900 000-00-.., example.ru и простой PNG, созданный локально через Sharp без ImageGen.
Seed `npm run db:seed:demo` применён к crm_demo; повторный запуск не создаёт дублей.

Причина пустого назначения: формирование прежнего снимка учитывало только
Property.commercialPurpose, а демо-объекты имеют Property.propertyType.
Печать/PDF/DOCX используют снимок назначения в приоритете; только при отсутствии
значения используют коммерческое назначение/тип Property с русской меткой.
Исторические снимки цены, адреса, площади и условий не переписаны.

Контракт real-estate-scrapper 2.1.0 проверен локально: yandex/onrealt/mirkvartir
возвращают address, district и title. Заголовок ранее терялся нормализацией,
а пустой address="" обходил fallback через `??`. Теперь пробелы/пустые строки
считаются отсутствием, title сохраняется, читаются вложенные raw/normalized снимки.
В сохранённых ответах Яндекса адрес действительно пуст, старый title не сохранён:
без повторного запроса восстановить их нельзя. Показываются «Адрес не указан площадкой»
и доступный фрагмент описания; для новых снимков — настоящий title. Адрес не выдумывается.
Продажа без единицы показана «за объект»; аренда — «единица цены не указана»,
вкладка «Требуют проверки». Критерии, источники доказательств и состояния русифицированы.

На каждом LIVE-кадре сохранена плашка «LIVE-данные, сохранённые при испытании …,
кадр переснят без новых вызовов». Это повторное отображение сохранённых данных,
а не новое испытание доступности площадок. SHA — базовый HEAD; изменения ещё не закоммичены.

Проверки: tsc --noEmit; ESLint изменённых TS/TSX; 7 регрессионных тестов отображения,
85 unit-тестов поиска, 7 demo-тестов; 3 integration/authorization-теста экспорта на crm_test_c.
Все PASS. Полный Playwright-набор не запускался. Миграций и npm install нет.

| Кадр | Время кадра UTC | Сохранённый источник UTC | SHA256 |
|---|---|---|---|
| [10-offer.png](../screenshots/vkr/10-offer.png) | 2026-11-05T14:01:06.375Z | DEMO | `4d5bd01faa6f420588a0076e9cc4699fc1b404f7bcfd7f2acdc20dcd00d66487` |
| [10b-offer-print.png](../screenshots/vkr/10b-offer-print.png) | 2026-11-05T14:01:13.162Z | DEMO | `cf475593fbaf9275f793ba0e8ea51bc83381ed7078911e8f1c1d00751c3c659e` |
| [10c-offer-pdf-page1.png](../screenshots/vkr/10c-offer-pdf-page1.png) | 2026-11-05T14:01:10.824Z | DEMO | `9b902a92c63173ecd002cb4bcaea38e8331b700187eed0cf1d7da4a19d753cfd` |
| [10d-offer-pdf-page2.png](../screenshots/vkr/10d-offer-pdf-page2.png) | 2026-11-05T14:01:10.827Z | DEMO | `cd7eeb21fa9bdb497d3e6922c773cb3e39f891ad7f4375cfb5f94bc0564ab5a8` |
| [live-ai/04-live-results.png](../screenshots/vkr/live-ai/04-live-results.png) | 2026-11-05T14:13:49.266Z | 2026-11-05T11:53:10.129Z | `a55574e7396e83f9f4d13291ede56a8788239b63de11748a940e362d09370f80` |
| [live-ai/05-evidence.png](../screenshots/vkr/live-ai/05-evidence.png) | 2026-11-05T14:13:49.519Z | 2026-11-05T11:53:10.129Z | `87907271f9e019a0c4e7a7c4fb52a7840aa3e228150d6f17971667cc551dee31` |
| [live-ai/19-rent-results.png](../screenshots/vkr/live-ai/19-rent-results.png) | 2026-11-05T14:04:15.688Z | 2026-11-05T12:04:09.444Z | `d1346e2003e739607f8760b529b84eb87bad41c4c2e774fe2b1055ee10a55176` |
| [live-ai/25-repeat-results.png](../screenshots/vkr/live-ai/25-repeat-results.png) | 2026-11-05T14:04:18.352Z | 2026-11-05T12:08:05.251Z | `5a608809863930bf009a40edb0dce2c0d1f0ca160f9c040555bdef1a99659f75` |
| [live-ai/26-comparison.png](../screenshots/vkr/live-ai/26-comparison.png) | 2026-11-05T14:04:21.589Z | 2026-11-05T11:53:10.129Z | `5d6e7d80191be450496bb101fd31eb7f5dddf0a2ac4088e2720d197d33002e6c` |

<!-- v31-demo:start -->
## v3.1 DEMO

Дата проверки: 06.11.2026. Все 27 кадров — синтетическая crm_demo, ru-RU, Asia/Novosibirsk. Desktop 1440×900, mobile 390×900. Режим DEMO указан в этом описании и manifest; в AI-чате также видна явная пометка DEMO-провайдера. Новых платных AI/веб/скрапер-вызовов этим прогоном нет. Скриншоты поиска ведёт отдельный агент.

96 задач охватывают ноябрь 2026 — январь 2027; три приоритета, 10 пунктов чек-листов у трёх задач, недельный/квартальный/годовой повторы. 16 звонков: четыре источника × четыре итога, включая спам, ошибочный, разовый и перспективный. Неперспективные звонки не связаны с Client/Need. Две личные подборки с тремя объектами каждая: независимая и связанная с потребностью. Четыре шаблона из templates/examples, по две версии и четыре сохранённых документа; два DocumentCollection FK. История AI содержит два синтетических сообщения и один неподтверждённый черновик.

Seed повторён; состав v3.1, число версий и документов не изменились: [проверка](../screenshots/vkr/v31/demo-data-verification.json). База и хранилище восстановлены после остановки локального tmpfs; чужие LIVE-испытания этим DEMO-прогоном не подтверждаются.

Настоящие сформированные DOCX/XLSX прочитаны из StorageAdapter с проверкой checksum. Все четыре режима отрендерены LibreOffice → PDF → Poppler PNG, по одной странице каждый; DOCX дополнительно проверен штатным render_docx.py. generated-docx/generated-xlsx — страница 1/1 с сохранением пропорций на 1440×900. Файлы в CRM не заменялись картинками.

Формы на кадрах — до сохранения: массовые задачи, квартальный повтор, привязка независимой подборки и AI-действие не подтверждены. Отклонённое завершение задачи действительно получило 422 OPEN_REQUIRED_CHECKLIST. Порог показан в форме без записи настройки. Мобильные формы и календарь прокручиваются штатно; снимок показывает текущий viewport.

Точечные UI-исправления: рабочие часы календаря видны во внутренней прокрутке; длинные дневные счётчики и фильтры сворачиваются; toolbar адаптирован к 390 px; расширен выбор потребности; исправлен повторный выбор клиента в массовых задачах; выровнены колонки/названия форматов шаблонов; необязательный контекст звонка свёрнут. Каждый из 27 кадров просмотрен.

Проверки: tsc --noEmit; целевой ESLint; 34 unit-теста планера/шаблонов; 7 read-only DEMO-тестов с фактическим хранилищем; inspect-v31; browser modes planner/tasks/recurrence/calls/collections/templates/timeline/chat — без pageerror. Это проверка DEMO и визуального среза общей рабочей копии, не production build/UAT/приёмка финального SHA.

Воспроизведение: явный DATABASE_URL на crm_demo → npm run db:seed:demo → npx tsx scripts/demo/inspect-v31.ts → npx vitest run --config scripts/demo/demo.vitest.config.mts. Dev-сервер — порт 3416, NEXT_DIST_DIR=.next-3416, AI_ENABLED=false, YANDEX_WEB_SEARCH_ENABLED=false, SCRAPER_ENABLED=false. Затем node scripts/vkr/v31-screenshots.mjs <mode>; экспорт файлов — scripts/demo/export-v31-documents.ts; рендер — scripts/vkr/v31-render-documents.mjs; после визуальной проверки — scripts/vkr/v31-finalize.mjs --reviewed. Для проверки идемпотентности сохраните первый seed-inspection.json как data/v31-shots/seed-first.json и повторите seed/inspect-v31 до финализации. Сессии закрываются через logout в finally. После съёмки сервер 3416 остановлен, временно отключённые must_change_password у трёх новых seed-пользователей восстановлены; добавления .next-3416 удалены из tsconfig, чужие include сохранены. Для повторной съёмки новых seed-пользователей требуется штатная смена временного пароля либо отдельная временная DEMO-сессия.

Даты кадров и базовый HEAD сохранены в [manifest](../screenshots/vkr/v31/manifest.json), контрольные суммы — [SHA256SUMS](../screenshots/vkr/v31/SHA256SUMS). HEAD в manifest относится к основе незакоммиченной общей копии.

| Кадр | Содержание (DEMO) | Размер | Время UTC |
|---|---|---|---|
| [planner-day.png](../screenshots/vkr/v31/planner-day.png) | Планер: День, цвета и легенда | 1440×900 | 2026-11-05T22:30:31.796Z |
| [planner-week.png](../screenshots/vkr/v31/planner-week.png) | Планер: Неделя, цвета и легенда | 1440×900 | 2026-11-05T22:30:34.066Z |
| [planner-month.png](../screenshots/vkr/v31/planner-month.png) | Планер: Месяц, цвета и легенда | 1440×900 | 2026-11-05T22:30:36.004Z |
| [planner-3months.png](../screenshots/vkr/v31/planner-3months.png) | Планер: Три месяца, цвета и легенда | 1440×900 | 2026-11-05T22:30:45.547Z |
| [planner-filters-employee.png](../screenshots/vkr/v31/planner-filters-employee.png) | Фильтр по сотруднику | 1440×900 | 2026-11-05T22:30:47.457Z |
| [planner-settings-threshold.png](../screenshots/vkr/v31/planner-settings-threshold.png) | Порог близкого срока: 24 часа, форма руководителя без изменения настройки | 1440×900 | 2026-11-05T22:30:47.671Z |
| [task-checklist.png](../screenshots/vkr/v31/task-checklist.png) | Чек-лист, сроки и прогресс | 1440×900 | 2026-11-05T22:31:20.924Z |
| [task-complete-warning.png](../screenshots/vkr/v31/task-complete-warning.png) | Сервер отклоняет завершение с обязательными открытыми пунктами; явное подтверждение ещё не дано | 1440×900 | 2026-11-05T22:31:32.298Z |
| [bulk-tasks-preview.png](../screenshots/vkr/v31/bulk-tasks-preview.png) | Предпросмотр двух задач; записи не создаются до подтверждения | 1440×900 | 2026-11-05T22:31:54.477Z |
| [recurrence-quarter.png](../screenshots/vkr/v31/recurrence-quarter.png) | Квартальный контроль договора: следующий экземпляр после выполнения, форма без сохранения | 1440×900 | 2026-11-05T22:32:07.984Z |
| [call-log-form.png](../screenshots/vkr/v31/call-log-form.png) | Ручной разовый звонок: источник и итог без создания клиента | 1440×900 | 2026-11-05T22:30:31.715Z |
| [call-log-spam.png](../screenshots/vkr/v31/call-log-spam.png) | Спам без Client и потребности; форма до сохранения | 1440×900 | 2026-11-05T22:30:32.016Z |
| [call-sources-stats.png](../screenshots/vkr/v31/call-sources-stats.png) | Источники и итоги звонков, числители и знаменатели на первичных синтетических записях | 1440×900 | 2026-11-05T22:31:06.481Z |
| [client-timeline.png](../screenshots/vkr/v31/client-timeline.png) | Таймлайн клиента: первичные события, документы, задачи, подборка | 1440×900 | 2026-11-05T22:22:59.343Z |
| [client-timeline-filtered-need.png](../screenshots/vkr/v31/client-timeline-filtered-need.png) | История по выбранной потребности клиента | 1440×900 | 2026-11-05T22:23:03.202Z |
| [collections-list.png](../screenshots/vkr/v31/collections-list.png) | Именованные подборки с клиентом и без клиента | 1440×900 | 2026-11-05T22:28:04.632Z |
| [collection-detail.png](../screenshots/vkr/v31/collection-detail.png) | Состав, комментарии, статусы и связь с потребностью | 1440×900 | 2026-11-05T22:28:17.075Z |
| [collection-link-need.png](../screenshots/vkr/v31/collection-link-need.png) | Выбор потребности для независимой подборки; привязка ещё не выполнена | 1440×900 | 2026-11-05T22:28:27.450Z |
| [templates-list.png](../screenshots/vkr/v31/templates-list.png) | Четыре режима шаблонизатора, текущие версии | 1440×900 | 2026-11-05T22:22:19.457Z |
| [template-versions.png](../screenshots/vkr/v31/template-versions.png) | История двух версий и манифест | 1440×900 | 2026-11-05T22:22:37.387Z |
| [template-preview.png](../screenshots/vkr/v31/template-preview.png) | Проверка исходной записи и явное подтверждение формирования | 1440×900 | 2026-11-05T22:22:50.883Z |
| [generated-docx.png](../screenshots/vkr/v31/generated-docx.png) | DEMO · настоящий сформированный DOCX, LibreOffice → PDF → Poppler PNG, страница 1/1; без правки содержимого | 1440×900 | 2026-11-05T22:21:32.485Z |
| [generated-xlsx.png](../screenshots/vkr/v31/generated-xlsx.png) | DEMO · настоящий сформированный XLSX, LibreOffice → PDF → Poppler PNG, страница 1/1; без правки содержимого | 1440×900 | 2026-11-05T22:21:38.263Z |
| [ai-chat-panel.png](../screenshots/vkr/v31/ai-chat-panel.png) | Личная история DEMO-провайдера, без внешнего вызова | 1440×900 | 2026-11-05T22:31:40.903Z |
| [ai-chat-draft-confirm.png](../screenshots/vkr/v31/ai-chat-draft-confirm.png) | Предпросмотр черновика перед явным подтверждением; задача не создана | 1440×900 | 2026-11-05T22:31:41.570Z |
| [mobile-planner.png](../screenshots/vkr/v31/mobile-planner.png) | Мобильный планер 390 px | 390×900 | 2026-11-05T22:30:49.036Z |
| [mobile-call-log.png](../screenshots/vkr/v31/mobile-call-log.png) | Ручная регистрация звонка на мобильном экране 390 px | 390×900 | 2026-11-05T22:30:32.164Z |
<!-- v31-demo:end -->
