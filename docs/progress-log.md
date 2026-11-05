# Журнал прогресса v2.4.1

Ветка: feature/tz-v2.4.1 (от main ba7e6fa). Нормативные документы: ТЗ_CRM_итоговое_v2.4.1_проверено.md поверх tz.md v1.6.1.

## 2026-11-05
- Создана ветка, ключ Yandex AI перенесён в .env (YANDEX_CLOUD_API_KEY), файл ключа и Real-Estate-Scrapper/ исключены из Git.
- Скрапер 2.1.0 положен в vendor/real-estate-scrapper-2.1.0.tgz.
- APP_TIMEZONE в .env -> Asia/Novosibirsk.
- Исполнители: OpenCode openai/agy/google недоступны (Model unavailable), лимит OpenCode Go исчерпан; разработка — субагенты gpt-6.1-sol/gpt-6-luna, тест/ревью — OpenCode iceman-contributor-free, beam-free.
- Коммиты: схема v2.4.1 (622c0ae), AI-домен (4465579), UI-основа (db7e059), домен поиска/скрапер (4867e98), P0 безопасность (ffd27da, 69/69 PG-тестов).
- Живой Yandex AI: POST /v1/responses aliceai-llm-flash/latest = 200; разбор фильтров падал AI_INVALID_JSON_RESULT -> поручено агенту AI-персистентности.
- На промежуточном срезе были в работе: календарь+уведомления+worker, галерея, AI-персистентность и /settings/ai, приложение/UI поиска, P1-А контур.
- Слиты: календарь/уведомления (57dd8d2), галерея (646d0ad), поиск-приложение (14758d1, фиксы 66af487), AI-персистентность (a2f596f), P1-А (1c450ef), ops/Docker+restore (e8f7269), демо (c68f4fa), доки (47d75ce), e2e+скриншоты (cadade5).
- Проверки: unit 301/301, integration+authorization 152/152, e2e 10/10, eslint/tsc/build PASS, restore-test PASS.
- Независимые ревью OpenCode: домен поиска (3 находки, исправлены), безопасность (находок нет), подборки (6 находок, исправлены).
- На промежуточном срезе были в работе: полировка UI + пересъёмка, замеры 3 пользователей/NFR-14, живой smoke скрапера.

- Финал: независимая проверка (OpenCode beam) на 8d30d92 — unit 500/500, integration+authorization 163/163, E2E 13/13, tsc/eslint/build/Docker PASS. Живой срез скрапера: Яндекс/OnRealt/Юла success, Авито/Домклик blocked, Циан parse_failed, Мир Квартир fetch_failed. Нагрузка 3 пользователей — локально, p95 <= 259 мс. Документация и карточки приёмки обновлены.

## 2026-11-05 — этап 2 (живой AI, UI/UX, скриншоты)
- Модели: openai/* в OpenCode недоступны, Go-лимит исчерпан -> разработка субагентами gpt-6.1-sol; тест/ревью OpenCode iceman/beam.
- На старте этапа запущены: live-испытания AI (бюджет сессии 250 руб.), КП A4+DOCX+PDF, UX поиска, календарь/сегодня/уведомления/клиент, отчёты/настройки ИИ/мобильный/prompt.

- Этап 2 реализован коммитами `91c6fc4`–`e48ea2a`: КП A4/PDF/DOCX, UX поиска, календаря/Сегодня/уведомлений/клиента, отчётов/ИИ/mobile, P2 call_note/offer_text. LIVE: частичный сбор, повтор/пустой результат/тайм-аут/restart PASS; web без карточек PARTIAL, Циан CAPTCHA и Авито/Домклик BLOCKED.
- Независимые Iceman/Beam находки исправлены `9e2b71b` / `f15adc8`. [QA](acceptance/qa-stage2.md) фиксирует dev E2E и ограничения production build (EPERM/Deny ACL); старые числа выше относятся к своим промежуточным версиям. Итоговый пересчёт — только [test-protocol](vkr/test-protocol.md).
- [Чистый deploy d69a3fb](operations/clean-deploy-v241.md): build/migrate/seed/login/PDF/T08/restart PASS; Docker очищен, удаление каталога клона blocked by policy. Поздний HEAD этим прогоном не проверен.
- Документация этапа 2: [приёмка](acceptance/stage2-live-ai-ux.md), user-guide, API, трассировка, README и IMPLEMENTATION_REPORT обновлены; NFR-14 локально, реальный Excel и UAT остаются PARTIAL.

- Этап 2 завершён (05.11.2026): живые испытания Yandex AI (10 подборов, 5 web_search, 12 прочих AI-вызовов этапа поиска + 4 P2 + 4 parse для пересъёмки; ~6,27 руб. по журналу CRM), UI/UX P1, P2 (заметка после звонка, тексты КП), исправления по Iceman/Beam, правило жилого назначения. Итог: unit 1003/1003, integration+authorization 197/197, E2E 16/16 (production), Docker и чистое развёртывание PASS.

## 2026-11-05 — ТЗ v3.1 (ветка feature/tz-v3.1 от 6bbdb7b)
- Модели: openai/* в OpenCode недоступны, Go-лимит исчерпан -> разработка субагентами gpt-6.1-sol; тест/ревью OpenCode iceman/beam.
- Волна 1: схема v3.1 (одна миграция), аудит 7 адаптеров, CAPTCHA human-in-the-loop.
