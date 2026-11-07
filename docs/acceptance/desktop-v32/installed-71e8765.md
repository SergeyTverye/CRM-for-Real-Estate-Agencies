# Установленная Windows CRM 71e8765

7 ноября 2026, текущий Windows 11 ПК. Только новые синтетические профили; пользовательская база не открывалась и не изменялась.

Официальный [EXE-артефакт](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42396531730/artifacts/13584259822), commit `71e87658ad555c3ca439cf06aef7781ef8566bda`.

- EXE: 585603587 байт, SHA-256 `a3e5ab26cbe6bcd249f2f222994052c4f985541c46b81910b9221d3262be311e`.
- Launcher: `8ac04258cd7c963e1bfcfec918f68e3bfd181c52398f058ef4f68a5f718c2ea8`.
- Bundled Node24.15.0; SQLite3.51.2; bundled Chromium156.0.8078.4. Host Node22 — только Playwright controller.
- Ресурсы приложения не исправлялись после установки. Установщик завершился с exit0; сохранение пользовательских данных по умолчанию.

## Фактические проверки

Обычный Tauri launcher без `--smoke`, изолированные LOCALAPPDATA/APPDATA/home/temp и Windows-only PATH. CUA увидел мастер первого запуска с путём собственного synthetic run, а после перезапуска — экран входа на новом фактическом loopback-порту. Сессия WebView отделена от Playwright; вход в native WebView не заявляется.

Два ограниченных прогона браузерной проверки:

1. `run-6d5eba25-dbfd-49a0-8450-66fc6b9b3860`: setup/demo/login и семь основных экранов PASS (9 завершённых проверок). На создании клиента остановился неверный exact-label селектор, не учитывавший звёздочку обязательного поля. Итог всего прогона FAIL, не скрыт. Реальные screenshots Today/planner/clients/properties/tasks/offers сохранены.
2. После исправления только селектора: `run-d9482d9c-b88c-484b-9195-fd5b668e1bd8`, `--focus-business`, **5/5 PASS**: setup/login, клиент через форму, 12-проверочный business cycle, клиент после собственного перезапуска. Основные экраны повторно не прогонялись. Teardown собственных launcher/supervisor/server завершён, cleanupError отсутствует.

Business cycle через API настоящей сессии браузера: звонок, active need с planned next task и связями, планер, локальный объект, подборка, структурированное предложение со snapshot, DOCX/защищённый document download/anonymous denial, PDF, XLSX и ZIP export. Это не ввод каждой бизнес-операции через формы.

| Реальный файл | Размер | Проверка |
|---|---:|---|
| offer.docx | 11275 | ZIP/content/metadata и защищённый download/hash |
| offer.pdf | 75555 | PDF/EOF/размер/hash; обе A4-страницы отрисованы Poppler и просмотрены |
| collection.xlsx | 9319 | ZIP/ExcelJS typed address/area/price |
| export.zip | 11790 | manifest/UUID-связи/CSV/checksum |

Файлы и точные SHA сохранены в собственном `business-cycle/` и `result.json`, не в Git. Синтетические screenshots с provenance — `docs/screenshots/vkr/v32-installed-*.png` и соседние `.md`.

## Windows CI того же EXE

1752 unit PASS/5 optional skip; 398 SQLite PASS/1 server-only skip; strict final runtime gate PASS; Rust1/1 PASS. На Windows Server2022 и2025 прошёл installer lifecycle: fresh install/readiness/setup/client, uninstall с сохранением данных, reinstall, overinstall/pre-update encrypted snapshot, реальное окно Tauri, повторный запуск без второго supervisor, uninstall/purge synthetic control file/регистрация/ярлыки/процессы. Доказательства: artifact `installer-evidence-windows-2022` и `installer-evidence-windows-2025` того же run. Это не чистые consumer Windows10/11 VM.

## Ограничения и найденные дефекты

- При установке поверх старого41c39b8 остались старые `app/package-lock.json` и примеры templates: новый EXE их не добавляет при fresh install, но не удаляет при overinstall. Подготовлено безопасное очищение только доказанных программных ресурсов с отказом при пользовательских документах/DB/keys/junction; следующий EXE должен фактически пройти обновление и проверку состава. Текущая overinstall-папка поэтому не проходит строгий allowlist.
- PDF layout читаем, но ссылка на карточку использовала внутренний localhost:4570 вместо фактического desktop-порта; fallback назначения показывал raw `commercial`. Исправлены исходники и48 focusedtests, проверка следующего установленного EXE ещё требуется.
- Предыдущие остановки browser harness были его окружением/селекторами: PATHEXT для icacls, Next clipped route announcer и штатные отмены GET-prefetch. Бизнес-API/HTTP>=400/неожиданные network/server errors остаются проверяемыми.
- Независимые installed PS7 проверки завершены: A→B→A и конфликт 61 boolean PASS (65 entries вместе с metadata), backup/verify/restore 20 boolean PASS, 0 failed. Проверены запись, документ/SHA, protective backup, ограничения standby, local device identity и завершение собственного launcher. Настоящие native picker/USB/cloud остаются отдельными незавершёнными GUI-испытаниями. Полная приёмка v3.2.1 не объявлена.
