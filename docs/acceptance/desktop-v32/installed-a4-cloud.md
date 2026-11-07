# Установленная Windows CRM a4: облачный приёмочный прогон

Официальный commit `a4a4120cd83b8f967b546472a25c8eb0909841de`.
Артефакт CI: [run 42415838070 / artifact 13592870756](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070/artifacts/13592870756).

## Идентификация сборки

- EXE SHA-256: `7434e3a5c8a646fe15663ed0b3649026404bb744165cc4baa1431b8e35c1040b`
- Размер EXE: 593 321 323 байт
- Launcher SHA-256: `bc46de74eb9490deac0e666d238864e61b46d326883a425a97ca779556b48a86`
- Bundled runtime: Node 24.15.0, SQLite 3.51.2, headless Chromium 156.0.8078.4 со smoke supervisor

## Граница доказательства

Проверка выполнена в headless Chromium 156.0.8078.4 со smoke supervisor, без native WebView. Использован свежий синтетический профиль; пользовательская БД не открывалась и не изменялась. Облачные операции выполнены только в уникальном synthetic prefix. Удаление remote-доказательств не выполнялось; исторические версии S3 не аудировались (`historicalS3versions: NOT_AUDITED`).

Чистые потребительские Windows 10/11 VM остаются BLOCKED по решению пользователя. Пять родительских проверок не равны полному набору DT и не объявляют v3.2.1 готовым.

## Фактические проверки

- CI run 42415838070: все шаги SUCCESS.
- Установщик Windows Server 2022/2025: 74 PASS / 0 FAIL на каждый образ, включая authenticated client page 200, удаление placeholder-файлов и сохранение пользовательских файлов.
- Фактический Windows 11: тихое обычное обновление завершилось с exit 0, пользовательская БД не изменилась, synthetic empty `app/public/.gitkeep` удалён установщиком, strict resource policy PASS, установленный патч отсутствует.
- Browser proof `data/qa-v32-installed-browser/run-c51da549-900d-4af6-9d8e-7ae15efa15b3/result.json`: terminal PASS; 5 родительских проверок PASS, 0 FAIL, 1 business NOTRUN; свежий синтетический профиль; реальный setup/login/форма клиента.
- Manager backup panel: оба направления, Yandex Object Storage и Облако Mail.ru, настроены и проверены через UI; DPAPI current-user готов; секреты не отображаются; пустые уникальные prefix обоих направлений проверены.
- Зашифрованный архив: ID `5299d5d2-9789-4c04-90cb-727a54aaa2ff`, размер 2 111 322 байт, SHA-256 `5a92d2d59cb908cd476effc240b4d400e9f0e0cdac6449ec4b0be7c1c1fc495d`; тот же ID/hash/size подтверждён в обоих облаках.
- Каталог каждого провайдера и restore modal проверены через реальный UI; restore commitment выполнен через authenticated API.
- Выполнены destination-specific supervised restores из каждого облака после изменения синтетического клиента; восстановлены record projection и документ размером 262 144 байт с совпадением SHA-256.
- Анонимные S3 GET и LIST: HTTP 403.
- Персистентность после перезапуска и корректное завершение собственных процессов: PASS.
- 13 helper checks: PASS.

## Дополнительный fault-прогон (изоляция отказа одного направления)

- Browser proof `data/qa-v32-installed-browser/run-bf1bf751-3743-420b-bff2-a8581677cc62/result.json`: terminal PASS; 5 родительских проверок PASS, 0 FAIL, 1 business NOTRUN; 16 helper checks PASS. Тот же официальный installed a4.
- Инъекция: synthetic wrong S3 key ID; изменений IAM/ОС-сети не было, значения облачных ключей не раскрывались. Результат: Yandex Object Storage завершился ошибкой, Облако Mail.ru прошло проверку; покрытие `INJECTED_SYNTHETIC_S3_KEY_ID_NOT_PHYSICAL_NETWORK_CUT`.
- После восстановления реальной конфигурации через UI retry поставлен в очередь; тот же архив прошёл verify в обоих направлениях: ID `163d9223-27b4-41fe-8119-ed819074a7ba`, 2 111 322 байт, SHA-256 `e9d9d4bf894e5420b5e835e5164c54451a45589540b26cc8c159e85d5338b7e4`; выполнены destination-specific supervised restores из обоих провайдеров, record projection и файл SHA совпали.
- Персистентность после перезапуска и корректное завершение собственных процессов: PASS. Remote-доказательства сохранены, не удалены.
- Обратный отказ (Mail.ru fail + Yandex success) не инъецировался; тем не менее требование «одно облако отказывает, второе работает» доказано.
- Дополнительный core/business прогон `data/qa-v32-installed-browser/run-26b62a10-9ae2-4ecd-98ee-6c6c94a7a89d/result.json`: 12/12 parent + 12/12 business API PASS; 4 реальных DOCX/PDF/XLSX/ZIP и 10 синтетических скриншотов; browser HTTP isolation external 0 (не физический offline ОС); PDF A4 читаем, «Коммерческая» локализована; card link origin `127.0.0.1:4011` на момент генерации (server log), после перезапуска origin изменился (`14572`) — постоянство ссылки через рестарт не заявляется. Этот прогон не является облачным доказательством.

## Не подтверждено этим прогоном

- Независимый сбой очереди: `IndependentQueueFailure=NOT_INJECTED`.
- Физический обрыв сети, USB, native file picker: NOTRUN.
- Native WebView и обычный пользовательский GUI-путь: не заявляются.
- Минимальные IAM-права ключа, условные записи, CAS/LOCK и матрица лимитов/прерываний: не доказаны.
- Отказ одного направления (Yandex) при работающем втором (Mail.ru) проверен через synthetic wrong S3 key ID; обратный отказ не инъецировался. Физический обрыв сети, USB и native file picker не выполнялись; DT-12 (offline queue) не заявляется.
- Исторические версии S3: не аудировались.
- Учётные данные, скриншоты, HAR и traces не сохранялись; значения bucket/email/key не приводятся.

## Связанные карточки

[DT-09](DT-09.md), [DT-10](DT-10.md), [DT-11](DT-11.md), [DT-25](DT-25.md), [DT-26](DT-26.md).
Ранее накопленные module-level доказательства сохраняются как исторические: [cloud-module-live.md](cloud-module-live.md), [cloud-smoke-live.md](cloud-smoke-live.md).
