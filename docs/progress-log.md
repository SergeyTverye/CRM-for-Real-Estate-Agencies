# Журнал прогресса v2.4.1

Ветка: feature/tz-v2.4.1 (от main ba7e6fa). Нормативные документы: ТЗ_CRM_итоговое_v2.4.1_проверено.md поверх tz.md v1.6.1.

## 2026-11-05
- Создана ветка, ключ Yandex AI перенесён в .env (YANDEX_CLOUD_API_KEY), файл ключа и Real-Estate-Scrapper/ исключены из Git.
- Скрапер 2.1.0 положен в vendor/real-estate-scrapper-2.1.0.tgz.
- APP_TIMEZONE в .env -> Asia/Novosibirsk.
- Исполнители: OpenCode openai/agy/google недоступны (Model unavailable), лимит OpenCode Go исчерпан; разработка — субагенты gpt-6.1-sol/gpt-6-luna, тест/ревью — OpenCode iceman-contributor-free, beam-free.- Коммиты: схема v2.4.1 (622c0ae), AI-домен (4465579), UI-основа (db7e059), домен поиска/скрапер (4867e98), P0 безопасность (ffd27da, 69/69 PG-тестов).
- Живой Yandex AI: POST /v1/responses aliceai-llm-flash/latest = 200; разбор фильтров падал AI_INVALID_JSON_RESULT -> поручено агенту AI-персистентности.
- В работе: календарь+уведомления+worker, галерея, AI-персистентность и /settings/ai, приложение/UI поиска, P1-А контур.
- Слиты: календарь/уведомления (57dd8d2), галерея (646d0ad), поиск-приложение (14758d1, фиксы 66af487), AI-персистентность (a2f596f), P1-А (1c450ef), ops/Docker+restore (e8f7269), демо (c68f4fa), доки (47d75ce), e2e+скриншоты (cadade5).
- Проверки: unit 301/301, integration+authorization 152/152, e2e 10/10, eslint/tsc/build PASS, restore-test PASS.
- Независимые ревью OpenCode: домен поиска (3 находки, исправлены), безопасность (находок нет), подборки (6 находок, исправлены).
- В работе: полировка UI + пересъёмка, замеры 3 пользователей/NFR-14, живой smoke скрапера.
